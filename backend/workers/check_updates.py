import packaging.version
import requests
import json
import re

import common.config_manager as config
from common.lib.helpers import add_notification
from backend.abstract.worker import BasicWorker
from pathlib import Path


class UpdateChecker(BasicWorker):
    """
    Check for updates

    Checks the configured Github repository (if any) for the latest packaged
    release. If the tag of that release is newer than the current version (per
    the .current_version file), a notification is shown to 4CAT admins in the
    web interface. Once the current version is updated the notification is
    automatically removed.
    """
    type = "check-for-updates"
    max_workers = 1

    # check once every three hours
    ensure_job = {"remote_id": config.get("4cat.github_url"), "interval": 10800}

    def work(self):
        versionfile = Path(config.get("PATH_ROOT"), ".current-version")
        repo_url = config.get("4cat.github_url")

        if not versionfile.exists() or not repo_url:
            # need something to compare against...
            return

        if not repo_url.endswith("/"):
            repo_url += "/"

        repo_id = re.sub(r"/$", "", re.sub(r"^https?://(www\.)?github\.com/", "", repo_url))

        with versionfile.open() as infile:
            current_version = infile.readline().strip()

        api_url = "https://api.github.com/repos/%s/releases/latest" % repo_id
        try:
            response = requests.get(api_url, timeout=5)
            response = response.json()
            if response.get("message") == "Not Found":
                self.log.warning("'4cat.github_url' may be misconfigured - repository does not exist or is private")
                return

            latest_tag = response["tag_name"]
            if latest_tag.startswith("v"):
                latest_tag = re.sub(r"^v", "", latest_tag)

            if packaging.version.parse(latest_tag) > packaging.version.parse(current_version):
                # update available!
                # show a notification for all admins (normal users can't update
                # after all)
                add_notification(self.db, "!admins",
                                 "A new version of 4CAT is [available](%s). The latest version is %s; you are running version %s." % (
                                     response["html_url"], latest_tag, current_version
                                 ), allow_dismiss=True)

            else:
                # up to date? dismiss any notifications about new versions
                self.db.execute("DELETE FROM users_notifications WHERE username = '!admins' "
                                "AND notification LIKE 'A new version of 4CAT%'")

        except (requests.RequestException, json.JSONDecodeError):
            # some issue with the data, or the GitHub API, but not something we
            # can fix from this end, so just silently fail
            return

$(document).ready(function(){

$(init);

/*
 * Page init
 */
function init() {

	// Functional stuff
	page_functions.init();

	// Annotations
	annotations.init();

}

/*
 * Handle annotations
 */
const annotations = {

	init: function() {

		let editor = $("#annotation-fields-editor");
		let editor_controls = $("#annotation-fields-editor-controls");
		var edits_made = false;

		// Add a new annotation field when clicking the plus icon
		$("#new-annotation-field").on("click", function(){
			annotations.addAnnotationField();
		});

		// Show and hide the annotations editor
		let toggle_fields = $("#toggle-annotation-fields")
		toggle_fields.on("click", function(){
			if (toggle_fields.hasClass("shown")) {
				$("#toggle-annotation-fields").html("<i class='fas fa-edit'></i> Edit fields");
				toggle_fields.removeClass("shown");
				editor.animate({"height": 0}, 250);
			}
			else {
				$("#toggle-annotation-fields").html("<i class='fas fa-eye-slash'></i> Hide editor");
				toggle_fields.addClass("shown");
				// Bit convoluted, but necessary to restore auto height
				let current_height = editor.height();
				let auto_height = editor.css("height", "auto").height();
				editor.height(current_height).animate({"height": auto_height}, 250, function(){
					editor.height("auto");
				});
			}
		});

		// Keep track of when the annotation fields were edited.
		editor_controls.on("click", "#apply-annotation-fields, .delete-input, .delete-option-field", function() {
			$("#apply-annotation-fields").removeClass("disabled");
		});
		editor_controls.on("change keydown", "input, select", function() {
			$("#apply-annotation-fields").removeClass("disabled");
		});	

		// Show and hide annotations
		$("#toggle-annotations").on("click", function(){
			if (!$(this).hasClass("disabled")) {
				if ($(this).hasClass("shown")) {
					annotations.hideAnnotations();
				}
				else {
					annotations.showAnnotations();
				}
			}
		});

		// Delete an entire annotation input
		// We're in a grid of threes, so this involves three divs
		editor_controls.on("click", ".annotation-field > .delete-input", function(){
				let parent_div = $(this).parent().parent();
				parent_div.next().remove(); // Input type
				parent_div.next().remove(); // Options
				parent_div.remove();		// Label
			});

		// Make saving available when annotation fields are changed
		editor_controls.on("click", ".delete-option-field", function() {
			annotations.deleteOption(this);
		});
		editor_controls.on("change", ".annotation-field-type", function(e) {annotations.toggleField(e.target);});
		
		// Make enter apply the option fields
		editor_controls.on("keypress", "input", function(e){
			if (e.which === 13) {
				annotations.applyAnnotationFields();
			}
		});

		// Save the annotation fields to the database
		$("#apply-annotation-fields").on("click", annotations.applyAnnotationFields);

		// Dynamically add a new option field when another is edited
		editor_controls.on("keyup", ".option-field > input", function(e) {
			if ($(this).val().length > 0) {
				annotations.addOptions(e.target);
			}
		});
		
		// Make saving available when annotations are changed
		let post_annotations = $(".post-annotations");
		post_annotations.on("keydown", "input, textarea", function() { annotations.enableSaving(); edits_made = true;});
		post_annotations.on("click", "option, input[type=checkbox], label", function() { annotations.enableSaving(); edits_made = true;});

		// Keep track of whether the annotations are edited or not.
		post_annotations.on("keydown change",
							".post-annotation-input, .post-annotation input, .post-annotation textarea",
							function(){
			annotations.markChanges($(this).parent());

		});

		// Save the annotations to the database
		$("#save-annotations").on("click", function(){
			if (!$(this).hasClass("disabled")) {
				annotations.saveAnnotations();
			}
		});

		// Save unsaved annotations upon changing a page.
		$('.page > a').click(function(){
			if (!$("#save-annotations").hasClass('disabled')) {
				annotations.saveAnnotations();
			}
		})

		// Check whether there's already fields saved for this dataset
		annotations.fieldsExist();

		// Save annotations every 10 seconds
		setInterval(function() {
			if (!$("#save-annotations").hasClass("disabled") && edits_made) {
				annotations.saveAnnotations();
			}
		}, 10000);

	},

	toggleField: function (el) {
		// Change the type of input fields when switching in the dropdown

		let type = $(el).val();

		let options = $(el).parent().parent().next();
		let option_fields = options.find(".option-field");

		if (type === "text" || type === "textarea") {
			option_fields.remove();
		}
		else if (type === "dropdown" || type === "checkbox") {
			if (option_fields.length === 0) {
				options.append(annotations.getInputField);
			}
		}
	},

	addOptions: function (el){
		// Dynamically a new options for dropdowns and checkboxes

		// If text is added to a field, and there are 
		// no empty fields available, add a new one.
		let no_empty_fields = true;
		let input_fields = $(el).parent().siblings();

		if (!$(el).val().length > 0) {
				no_empty_fields = false;
			}
		input_fields.each(function(){
			let input_field = $(this).find("input");
			let val = input_field.val();

			if (!val.length > 0) {
				no_empty_fields = false;
			}
		});
		// Add a new field if there's no empty ones
		if (no_empty_fields) {
			$(el).parent().after(annotations.getInputField);
		}

		// Make sure that you can't delete the last remaining field.
		input_fields = $(el).parent().parent();
		$(input_fields).find(".delete-option-field").remove();

		if (input_fields.length > 0) {

			let amount = $(input_fields).find(".option-field").length;
			let count = 0;

			$(input_fields).find(".option-field").each(function(){
				count++;

				// Don't add a delete option for the last (empty) input.
				if (count === amount) {
					return false;
				}
				$(this).append(`
					<a class="button-like-small delete-option-field"><i class='fas fa-trash'></i></a>`);
			});
		}
	},

	deleteOption: function (el) {
		let input_fields = $(el).parent().parent();
		$(el).parent().remove();

		// Make sure you can't delete the last element
		if (input_fields.find(".option-field").length === 1) {
			input_fields.find(".delete-option-field").remove();
		}
	},

	parseAnnotationFields: function () {
		/*
		Validates and converts the fields in the annotations editor.
		Returns an object with the set annotation fields.
		*/

		let annotation_fields = {};
		let warning = "";
		let labels_added = []

		annotations.warnEditor("");

		$(".annotation-field-label").removeClass("invalid")

		// Parse information from the annotations editor.
		$(".annotation-field").each(function(){
			// To align the input form, we're in a grid of threes:
			// label, input type, options.
			// Navigate the DOM to get these elements:
			let label_field = $(this).children(".annotation-field-label");
			let type_field = $(this).parent().next();
			let options_field = $(this).parent().next().next();

			let label = label_field.val().replace(/\s+/g, ' ');

			// Get the ID of the field, so we
			// can later check if it already exists.
			let field_id = this.id.split("-")[1];

			// Make sure the inputs have a label
			if (!label.length > 0) {
				label_field.addClass("invalid");
				warning  = "Field labels can't be empty";
			}
			// Make sure the names can't be duplicates
			else if (labels_added.includes(label)) {
				warning = "Field labels must be unique";
				label_field.addClass("invalid");
			}

			// We can't add field labels that are also existing column names
			else if (original_columns.includes(label)) {
				warning = "Field label " + label + " is already present as a dataset item, please rename.";
				label_field.addClass("invalid");
			}

			// Set the types and values of the annotation
			type = type_field.find(".annotation-field-type").val();

			// Keep track of the labels we've added
			labels_added.push(label)

			if (type === "text" || type === "textarea") {
				annotation_fields[field_id] = {"type": type, "label": label};
			}
			// Add options for dropdowns and checkboxes
			else {
				let options = []; // List of dicts, because it needs to be ordered
				let option_labels = [];
				let no_options_added = true;

				options_field.find(".option-field > input").each(function(){
					let option_label = $(this).val();
					let option_id = $(this).id.replace("input-", "");

					if (!option_labels.includes(option_label) && option_label.length > 0) {

						// We're using a unique key for options as well.
						option = {}
						option[option_id] = option_label
						options.push(option);
						option_labels.push(option_label);
						no_options_added = false;
					}
					// Input fields must have a unique label.
					else if (option_labels.includes(option_label)) {
						warning = "Fields must be unique";
						$(this).addClass("invalid");
					}
					// Fields for dropdowns and checkboxes may be emtpy.
					// We simply don't push them in that case.
					// But there must be at least one field in there.

				});

				if (no_options_added) {
					warning = "At least one field must be added";
					$(this).find(".option-field > input").first().addClass("invalid");
				}

				if (Object.keys(options).length > 0) {
					// Strip whitespace from the input field key
					label = label.replace(/\s+/g, ' ');
					annotation_fields[field_id] = {"type": type, "label": label, "options": options};
				}
			}
		});

		if (warning.length > 0) {
			return warning;
		}
		return annotation_fields;
	},

	parseAnnotation: function(el) {
		/*
		Converts the DOM objects of an annotation field
		to an annotation Object.

		Must be given a .post-annotation div element

		*/
		console.log(el)
		let ann_input = el.find(".post-annotation-input");
		let ann_classes = el.attr("class").split(" ");
		let ann_input_classes = ann_input.attr("class").split(" ");
		let field_id = ann_input_classes[1].replace("field-", "");
		let annotation_type = ann_classes[2].replace("type-", "");
		let item_id = ann_classes[3].replace("item-id-", "");
		let label = el.find(".annotation-label").text();
		let author = el.find(".annotation-author").html();
		let timestamp = parseInt(el.find(".epoch-timestamp-edited").html());

		let val = undefined;
		let edited = false

		if (annotation_type === "text" || annotation_type === "textarea") {
			val = ann_input.val();
			// It can be the case that the input text is deleted
			// In this case we *do* want to push new data, so we check
			// whether there's an 'edited' class present and save if so.
			if (ann_input.hasClass("edited")) {
				edited = true
			}
		}
		else if (annotation_type === "dropdown") {
			val = ann_input.find(".post-annotation-options").val();
		}
		else if (annotation_type === "checkbox") {
			val = [];
			ann_input.find(".post-annotation-options > input").each(function(){
				if (ann_input.is(":checked")) {
					val.push(ann_input.val());
				}
				if (ann_input.hasClass("edited")) {
					edited = true
				}
			});
			if (!val.length > 0) {
				val = undefined;
			}
		}

		// if ((val !== undefined && val !== "") || edited) {
		// 	vals_changed = true;
		// 	val = "";
		// 	console.log("EDITED")
		// }
		//
		// if (vals_changed){
		// 	annotation[post_id] = post_vals;
		// }

		// Create an annotation object and add them to the array.
		let annotation = {
			"field_id": field_id,
			"item_id": item_id,
			"label": label,
			"type": annotation_type,
			"value": val,
			"author": author,
			"by_processor": false, // Explorer annotations are human-made!
			"timestamp": timestamp
		}
		console.log(annotation)
		return annotation
	},

	applyAnnotationFields: function (e){
		// Applies the annotation fields to each post on this page.

		// First we collect the annotation information from the editor
		let annotation_fields = annotations.parseAnnotationFields(e);
		let fields_to_add = {};

		// Show an error message if the annotation fields were not valid.
		if (typeof annotation_fields == "string") {
			annotations.warnEditor(annotation_fields);
		}

		// If everything is ok, we're going to add
		// the annotation fields to each post on the page.
		else {

			$("#apply-annotation-fields").html("<i class='fas fa-circle-notch spinner'></i> Applying")
			
			// Remove warnings
			annotations.warnEditor("")
			$("#annotation-field").find("input").each(function(){
				$(this).removeClass("invalid");
			});
			$(".option-fields").find("input").each(function(){
				$(this).removeClass("invalid");
			});

			// We store the annotation fields in the dataset table.
			annotations.saveAnnotationFields(annotation_fields);
			location.reload();
		}
	},

	saveAnnotationFields: function (annotation_fields){
		// Save the annotation fields used for this dataset
		// to the datasets table.

		if (annotation_fields.length < 1) {
			return;
		}

		// If there's annotation fields, we can enable/disable the buttons
		annotations.fieldsExist();

		let dataset_key = $("#dataset-key").text();

		// AJAX the annotation forms
		$.ajax({
			url: getRelativeURL("explorer/save_annotation_fields/" + dataset_key),
			type: "POST",
			contentType: "application/json",
			data:  JSON.stringify(annotation_fields),

			success: function (response) {
				// If the query is accepted by the server.
				if (response === 'success') {
					$("#annotations-editor-container").hide();
					$("#apply-annotation-fields").addClass("disabled");
				}

				// If the query is rejected by the server.
				else {
					annotations.warnEditor("Couldn't save annotation fields");
				}
			},
			error: function (error) {
				annotations.warnEditor(error);
			}
		});
	},

	saveAnnotations: function (){
		// Write the annotations to the dataset and annotations table.

		// First we're going to collect the data for this page.
		// Loop through each post's annotation fields.
		let anns = [];
		let dataset_key = $("#dataset-key").text();

		$(".posts > li").each(function(){

			let post_annotations = $(this).find(".post-annotations");

			if (post_annotations.length > 0) {

				post_annotations.find(".post-annotation").each(function(){
					
					// Extract annotation object from the element
					let annotation = annotations.parseAnnotation($(this));

					if (annotation) {
						anns.push(annotation);
					}
				});
			}
		})

		let save_annotations = $("#save-annotations");
		save_annotations.html("<i class='fas fa-circle-notch spinner'></i> Saving annotations")
		annotations.disableSaving();

		let code = ""

		$.ajax({
			url: getRelativeURL("explorer/save_annotations/" + dataset_key),
			type: "POST",
			contentType: "application/json",
			data: JSON.stringify(anns),

			success: function (response) {

				if (response === 'success') {
					code = response

					annotations.enableSaving();
					save_annotations.html("<i class='fas fa-save'></i> Annotations saved");
					save_annotations.addClass("disabled");
					//var old_annotation_fields = $("#annotation-field").each();
					// alert(alert_message);
				}
				else {
					annotations.enableSaving();
					save_annotations.html("<i class='fas fa-save'></i> Save annotations");
					alert("Couldn't save annotations");
					save_annotations.removeClass("disabled");
					console.log(response);
				}
			},
			error: function (error) {
				annotations.enableSaving();
				save_annotations.html("<i class='fas fa-save'></i> Save annotations");
				save_annotations.removeClass("disabled");
				//alert("Couldn't save annotations");
				console.log(error)
			}
		});
	},

	fieldsExist: function(){
		// Annotation fields are sent by the server
		// and saved in a script in the header.
		// So we just need to check whether they're there.

		if (Object.keys(annotation_fields).length < 1) {
			$("#toggle-annotations").addClass("disabled");
			return false;
		}
		else {
			$("#toggle-annotations").removeClass("disabled");
			return true;
		}
	},

	enableSaving: function(){
		// Enable saving annotations to the database
		$("#save-annotations, #save-to-dataset").removeClass("disabled");
		$("#save-annotations").html("<i class='fas fa-save'></i> Save annotations");
	},

	disableSaving: function(){
		// Disable saving annotations to the database
		$("#save-annotations, #save-to-dataset").addClass("disabled");
	},

	warnEditor: function(warning) {
		
		let warn_field = $("#input-warning");
		warn_field.html(warning);
		if (warn_field.hasClass("hidden")) {
			warn_field.removeClass("hidden");
			warn_field.fadeIn(200);
		}
	},

	showAnnotations: function() {
		let ta = $("#toggle-annotations");
		ta.addClass("shown");
		ta.removeClass("disabled");
		ta.html("<i class='fas fa-eye-slash'></i> Hide annotations");
		// Bit convoluted, but necessary to have auto height
		let pa = $(".post-annotations");
		let current_height = pa.height();
		let auto_height = pa.css("height", "auto").height();
		pa.height(current_height).animate({"height": auto_height}, 250, function(){
			pa.height("auto");
		});
	},

	hideAnnotations: function() {
		let ta = $("#toggle-annotations");
		ta.removeClass("shown");
		ta.html("<i class='fas fa-eye'></i> Show annotations");
		let pa = $(".post-annotations");
		pa.animate({"height": 0}, 250);
	},

	addAnnotationField: function(){
		/*
		Adds an annotation field input element;
		these have no IDs yet, we'll add a hashed database-label string when saving.
		*/

		let annotation_field = `<div>
             <dd class="annotation-fields-row annotation-field">
                 <input type="text" id="field-undefinedrandomint"
                 class="annotation-field-label" name="annotation-field-label" placeholder="Field label">
                 <a class="button-like-small delete-input"><i class="fas fa-trash"></i></a>
             </dd>
         </div>
         <div>
             <dd>
                 <select name="annotation-field-type" class="annotation-field-type">
                     <option class="annotation-field-option" value="text" selected>Text</option>
                     <option class="annotation-field-option" value="textarea">Text (large)</option>
                     <option class="annotation-field-option" value="checkbox">Checkbox</option>
                     <option class="annotation-field-option" value="dropdown">Dropdown</option>
                 </select>
             </dd>
         </div><div></div>`.replace("randomint", Math.floor(Math.random() * 100000000).toString());
		$(annotation_field).insertBefore($("#edit-annotation-fields"));
	},

	getInputField: function(id){
		// Returns an option field element with a pseudo-random ID, if none is provided.
		if (id === undefined || id === 0) {
			id = Math.floor(Math.random() * 100000000).toString();
		}
		return "<div class='option-field'><input type='text' id='input-" + id + "' placeholder='Value'></div>";
	},

	markChanges: function(el) {
		// Adds current changes to a post annotation so we can save these later.
		// Currently includes the time of edits and the username of the annotator
		let current_username = $("#current-username").html();
		let current_date = Date.now() / 1000;
		let input_field = el.find(".post-annotation-input");
		input_field.addClass("edited");
		$(el).find(".annotation-author").html(current_username);
		$(el).find(".epoch-timestamp-edited").html(current_date);
		$(el).find(".timestamp-edited").html(getLocalTimeStr(current_date));
	}
};

const page_functions = {
	init: function() {
		document.querySelectorAll('.quote a').forEach(link => link.addEventListener('mouseover', function() {
			let post = 'post-' + this.getAttribute('href').split('-').pop();
			document.querySelector('#' + post).classList.add('highlight');
		}));
		document.querySelectorAll('.quote a').forEach(link => link.addEventListener('mouseout', function() {
			document.querySelectorAll('.thread li').forEach(link => link.classList.remove('highlight'));
		}));

		// Change timestamps to the client's timezone
		document.querySelectorAll(".timestamp-to-convert").forEach(function(el){
			el.innerText = getLocalTimeStr(el.innerText);
		});

		// Reorder the dataset when the sort type is changed
		$(".sort-select").on("change", function(){

			// Get the column to sort on, an whether we should sort in reverse.
			let selected = $("#column-sort-select").find("option:selected").val();
			let order = $("#column-sort-order").find("option:selected").val();

			sort_order = ""
			if (order === "reverse"){
				sort_order = "&order=reverse"
			}

			let dataset_key = $("#dataset-key").text();
			window.location.href = getRelativeURL("results/" + dataset_key + "/explorer/?sort=" + selected + sort_order);
		});

		// Change the dropdown sort option based on the URL parameter
		let searchParams = new URLSearchParams(window.location.search)
		let selected = searchParams.get("sort");
		let sort_order = searchParams.get("order");
		$("#column-sort-select").find("option[value='" + selected + "']").attr("selected", "selected");
		if (sort_order) {
			$("#column-sort-order").find("option[value='" + sort_order + "']").attr("selected", "selected");
		}
	}
};

/**
 * Get absolute API URL to call
 *
 * Determines proper URL to call
 *
 * @param endpoint Relative URL to call (/api/endpoint)
 * @returns  Absolute URL
 */
function getRelativeURL(endpoint) {
	let root = $("body").attr("data-url-root");
	if (!root) {
		root = '/';
	}
	return root + endpoint;
}

function getLocalTimeStr(epoch_timestamp) {
	let local_date = new Date(parseInt(epoch_timestamp) * 1000)
	local_date = Intl.DateTimeFormat("en-GB", {dateStyle: "medium", timeStyle: "medium"}).format(local_date);
	return local_date
}

});
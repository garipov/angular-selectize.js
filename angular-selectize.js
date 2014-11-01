/**
 * Directive to convert a select into a selectize.js hybrid textbox and <select>
 * Supports an ngOptions expression. Tested with:
 *  `label for value in array`
 *  `select as label for value in array`
 * In theory supports the same options as selectize.js
 *
 * Usage:
 * <select
 *   multiple
 *   ng-model="selected"
 *   ng-options="option.id as option.name for option in options"
 *   selectize="{ plugins: ['remove_button'], create: 'true' }">
 * </select>
 *
 * Attributes:
 *   multiple: Converts the select into text input of tags
 *
 * (c) 2014 Evan Oxfeld https://github.com/EvanOxfeld/angular-selectize.js
 * License: MIT
 **/

(function (angular) {
  'use strict';

  angular.module('selectize', [])

    .directive('selectize', ['$parse', '$timeout', function($parse, $timeout) {
      var NG_OPTIONS_REGEXP = /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?\s+for\s+(?:([\$\w][\$\w]*)|(?:\(\s*([\$\w][\$\w]*)\s*,\s*([\$\w][\$\w]*)\s*\)))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?$/;

      return {
        scope: {
          multiple: '@',
          opts: '@selectize'
        },
        require: '?ngModel',
        link: function(scope, element, attrs, ngModelCtrl) {
          var opts = scope.$parent.$eval(scope.opts) || {};
          var initializing = false;
          var modelUpdate = false;
          var optionsUpdate = false;
          var optionsInitialised = false,
              options = {},         // all options
              newOptions = [],      // new options to add into selectize
              removedOptions = [],  // values of options to remove
              userOptions = [],     // options created from selectize
              lastOptionIndex = 0;
          var selectize, newModelValue, updateTimer;

          watchModel();
          subscribeToScopeDestroy();

          if (attrs.ngDisabled) {
            watchParentNgDisabled();
          }

          if (!attrs.ngOptions) {
            return;
          }

          var match = attrs.ngOptions.match(NG_OPTIONS_REGEXP);
          var valueName = match[4] || match[6];
          var optionsExpression = match[7];
          var optionsFn = $parse(optionsExpression);
          var displayFn = $parse(match[2] || match[1]);
          var valueFn = $parse(match[2] ? match[1] : valueName);
          var groupFn = $parse(match[3]);
          var optionContext = scope.$parent.$new();

          watchParentOptions();

          function watchModel() {
            scope.$watchCollection(function() {
              return ngModelCtrl.$modelValue;
            }, function(modelValue) {
              newModelValue = modelValue;
              modelUpdate = true;
              if (!updateTimer) {
                scheduleUpdate();
              }
            });
          }

          function watchParentOptions() {
            scope.$parent.$watchCollection(optionsExpression, function(afterOptions, beforeOptions) {
              var i, option, isNew,
                  unremovableIndexes = {};

              for (i in afterOptions){
                option = afterOptions[i];
                isNew = true;

                // find in old options
                for (var j in beforeOptions ){
                  if ( beforeOptions[j] === option ){
                    isNew = false;
                    unremovableIndexes[j] = true;
                    break;
                  }
                }

                if ( isNew ){
                  if ( userOptions.indexOf(option) > -1 ) isNew = false;
                }

                if ( isNew ){
                  newOptions[lastOptionIndex] = option;
                }

                if ( isNew || !optionsInitialised ) {
                  options[lastOptionIndex++] = option;
                }
              }

              for ( i in beforeOptions){
                if ( !unremovableIndexes.hasOwnProperty(i) ){
                  removedOptions.push(i);
                }
              }

              optionsInitialised = true;
              optionsUpdate = true;

              if (!updateTimer) {
                scheduleUpdate();
              }
            });
          }

          function watchParentNgDisabled() {
            scope.$parent.$watch(attrs.ngDisabled, function(isDisabled) {
              if (selectize) {
                isDisabled ? selectize.disable() : selectize.enable();
              }
            });
          }

          function scheduleUpdate() {
            if (!selectize) {
              if (!initializing) {
                initSelectize();
              }
              return;
            }

            updateTimer = $timeout(function() {
              var model = newModelValue;
              if (optionsUpdate) {
                var i;

                for ( i in newOptions ) {
                  var data = {},
                      option = newOptions[i];

                  data[selectize.settings.valueField] = i;
                  data[selectize.settings.labelField] = getOptionLabel(option);
                  data[selectize.settings.optgroupField] = getGroupLabel(option);

                  selectize.addOption(data);
                  delete selectize.userOptions[i];
                }


                for ( i in removedOptions ) {
                  selectize.removeOption(i);
                }

                newOptions.length = 0;
                removedOptions.length = 0;
              }

              if (modelUpdate) {
                var selectedItems = getSelectedItems(model);
                var selectizeItems = selectize.getValue();

                if ( selectizeItems && selectize.settings.mode === 'single' ){
                  selectizeItems = [selectizeItems]
                }

                if ( !angular.equals(selectedItems, selectizeItems) ){
                  selectize.clear();

                  selectedItems.forEach(function(item) {
                    selectize.addItem(item);
                  });
                }

                //wait to remove ? to avoid a single select from briefly setting the model to null
                selectize.removeOption('?');

                //var $option = selectize.getOption(0);
                //if ($option) selectize.setActiveOption($option);
              }

              modelUpdate = optionsUpdate = false;
              updateTimer = null;
            });
          }

          function initSelectize() {
            initializing = true;
            scope.$evalAsync(function() {
              initializing = false;
              if (attrs.ngOptions) {
                opts.create = false;
              }
              element.selectize(opts);
              selectize = element[0].selectize;
              if (attrs.ngOptions) {
                if (scope.multiple) {
                  selectize.on('item_add', onItemAddMultiSelect);
                  selectize.on('item_remove', onItemRemoveMultiSelect);
                } else if (opts.create) {
                  selectize.on('item_add', onItemAddSingleSelect);
                }
                selectize.on('option_add', onOptionAdd);
                selectize.on('option_remove', onOptionRemove);
              }
            });
          }

          function onOptionAdd(value, option) {
            options[value] = option;
            userOptions.push(option);
          }

          function onOptionRemove(value){
            var option = options[value];
            if ( option ) {
              delete options[value];

              var i = userOptions.indexOf(option);
              if ( i > -1 ) {
                userOptions.splice(i, 1);
              }
            }
          }

          function onItemAddMultiSelect(value, $item) {
            var model = ngModelCtrl.$viewValue;
            var option = options[value];
            value = option ? getOptionValue(option) : value;

            if (value && model.indexOf(value) === -1) {
              model.push(value);

              scope.$evalAsync(function() {
                ngModelCtrl.$setViewValue(model);
              });
            }
          }

          function onItemAddSingleSelect(value, $item) {
            var model = ngModelCtrl.$viewValue;
            var option = options[value];
            value = option ? getOptionValue(option) : null;


            if (model !== value) {
              model = value;

              scope.$evalAsync(function() {
                ngModelCtrl.$setViewValue(model);
              });
            }
          }

          function onItemRemoveMultiSelect(value) {
            var model = ngModelCtrl.$viewValue;
            var option = options[value];
            value = option ? getOptionValue(option) : value;

            var index = model.indexOf(value);
            if (index >= 0) {
              model.splice(index, 1);
              scope.$evalAsync(function() {
                ngModelCtrl.$setViewValue(model);
              });
            }
          }

          function getSelectedItems(model) {
            model = angular.isArray(model) ? model : [model] || [];

            if (!attrs.ngOptions) {
              return model.map(function(i) { return selectize.options[i] ? selectize.options[i][selectize.settings.valueField] : ''});
            }

            var key, option, optionValue, selected = [];

            for ( key in options ) {
              option = options[key];
              optionValue = getOptionValue(option);

              if (model.indexOf(optionValue) >= 0) {
                if ( selected.indexOf(key) === -1 ) {
                  selected.push(key);
                }
              }
            }

            return selected;
          }

          function getOptionValue(option) {
            if ( userOptions.indexOf(option) > -1 ) {
              return option[selectize.settings.valueField];
            } else {
              optionContext[valueName] = option;
              return valueFn(optionContext);
            }
          }

          function getOptionLabel(option) {
            if ( userOptions.indexOf(option) > -1 ) {
              return option[selectize.settings.labelField];
            } else {
              optionContext[valueName] = option;
              return displayFn(optionContext);
            }
          }

          function getGroupLabel(option) {
            if ( userOptions.indexOf(option) > -1 ) {
              return option[selectize.settings.optgroupField];
            } else {
              optionContext[valueName] = option;
              return groupFn(optionContext);
            }
          }

          function subscribeToScopeDestroy() {
            scope.$on('$destroy', function () {
              if (updateTimer) {
                $timeout.cancel(updateTimer);
              }
              if (optionContext) optionContext.$destroy();
              if (selectize) selectize.destroy();
            });
          }

          return;
          // test functions to add to original options
          // get field name from valueExpression or labelExpression
          function getField(expressionField, expressionObj){
            if ( !angular.isString(expressionField) || !angular.isString(expressionObj) ) return false;

            var simpleField = /^[a-zA-Z_-]+$/,
                field = false;

            if ( !simpleField.test(expressionObj) ) return false;

            if ( expressionField.indexOf(expressionObj + '.') === 0 ){
              field = expressionField.substr(expressionObj.length + 1);
            } else if ( expressionField.indexOf(expressionObj + "['") === 0 ){
              field = expressionField.substr(expressionObj.length + 2, expressionField.length - expressionObj.length - 4);
            }

            if ( !field || !simpleField.test(field) ) return false;

            return field;
          }

          function addValueToOptions(options, value){
            if ( selectize.settings.create ){
              var option = selectize.options[value];
              // if create is function then option - should be correct object
              if ( angular.isFunction(selectize.settings.create) ){
                options.push(option);
              } else {
                // else - lets try to generate correct option for our collection
                var labelField, valueField;
                if ( valueName === valueExpression ){
                  options.push(value);
                } else if ( (valueField = getField(valueExpression, valueName)) && (labelField = getField(labelExpression, valueName)) ) {
                  var groupValue = null,
                      obj = {};

                  obj[valueField] = option[selectize.settings.valueField];
                  obj[labelField] = option[selectize.settings.labelField];

                  groupValue = option[selectize.settings.optgroupField];

                  if ( groupValue ){
                    var groupField = getField(groupExpression, valueName);
                    if ( groupField ) obj[groupField] = groupValue;
                  }

                  options.push(obj);
                }
              }
            }
          }

          //option_add
          function onOptionAdd(value, $item) {
            var options = optionsFn(scope.$parent);
            addValueToOptions(options, value);
          }
        }
      };
    }]);
})(angular);

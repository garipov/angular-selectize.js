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
                }
              }
            });
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
            optionContext[valueName] = option;
            return valueFn(optionContext);
          }

          function getOptionLabel(option) {
            optionContext[valueName] = option;
            return displayFn(optionContext);
          }

          function getGroupLabel(option) {
            optionContext[valueName] = option;
            return groupFn(optionContext);
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
      }
    };
  }]);
})(angular);

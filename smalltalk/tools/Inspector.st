Smalltalk interchangeVersion: '1.0'!
Class named: 'Inspector'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'subject selection offset expression process service'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Tools-Inspector'!

Inspector method!
evaluate: mode process := service call: 'evaluate' with: expression with: mode!
Annotation key: 'category' value: 'inspecting'!

Inspector method!
expression: text expression := service call: 'text' with: text!
Annotation key: 'category' value: 'inspecting'!

Inspector method!
page: start offset := service call: 'offset' with: start. selection := 'self'!
Annotation key: 'category' value: 'inspecting'!

Inspector method!
select: name selection := service call: 'field' with: name!
Annotation key: 'category' value: 'inspecting'!

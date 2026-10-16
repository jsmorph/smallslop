Smalltalk interchangeVersion: '1.0'!
Class named: 'ExceptionSet'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'selectors'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Exceptions'!

ExceptionSet method!
, anotherSelector ^ExceptionSet new privateSelectors: (selectors copyWith: anotherSelector)!
Annotation key: 'category' value: 'exception selection'!

ExceptionSet method!
handles: exception ^selectors anySatisfy: [:each | each handles: exception]!
Annotation key: 'category' value: 'exception selection'!

ExceptionSet method!
privateSelectors: anArray selectors := anArray!
Annotation key: 'category' value: 'private'!

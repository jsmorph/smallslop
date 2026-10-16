Smalltalk interchangeVersion: '1.0'!
Class named: 'Warning'
  superclass: 'Notification'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Exceptions'!

Warning method!
defaultAction ^self privateWarn: self description!
Annotation key: 'category' value: 'exception description'!

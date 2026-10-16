Smalltalk interchangeVersion: '1.0'!
Class named: 'ZeroDivide'
  superclass: 'Error'
  indexedInstanceVariables: #none
  instanceVariableNames: 'dividend'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Exceptions'!

ZeroDivide method!
dividend ^dividend!
Annotation key: 'category' value: 'accessing'!

ZeroDivide method!
dividend: argument dividend := argument!
Annotation key: 'category' value: 'accessing'!

ZeroDivide method!
isResumable ^true!
Annotation key: 'category' value: 'exception description'!

ZeroDivide classMethod!
dividend: argument ^self new dividend: argument; signal!
Annotation key: 'category' value: 'signaling'!

Smalltalk interchangeVersion: '1.0'!
Class named: 'UndefinedObject'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Objects'!

UndefinedObject method!
isNil ^true!
Annotation key: 'category' value: 'testing'!

UndefinedObject method!
notNil ^false!
Annotation key: 'category' value: 'testing'!

UndefinedObject method!
printOn: aStream aStream nextPutAll: 'nil'!
Annotation key: 'category' value: 'printing'!

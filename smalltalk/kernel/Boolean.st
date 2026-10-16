Smalltalk interchangeVersion: '1.0'!
Class named: 'Boolean'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Objects'!

Boolean method!
eqv: aBoolean ^self == aBoolean!
Annotation key: 'category' value: 'logical'!

Boolean method!
xor: aBoolean ^(self == aBoolean) not!
Annotation key: 'category' value: 'logical'!

Smalltalk interchangeVersion: '1.0'!
Class named: 'Float'
  superclass: 'Number'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Numbers'!

Float method!
floorLog: radix ^(self ln / radix asFloat ln) floor!
Annotation key: 'category' value: 'mathematical functions'!

Float method!
isFloat ^true!
Annotation key: 'category' value: 'testing'!

Float method!
reciprocal ^1.0 / self!
Annotation key: 'category' value: 'arithmetic'!

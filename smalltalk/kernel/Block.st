Smalltalk interchangeVersion: '1.0'!
Class named: 'Block'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Objects'!

Block method!
ensure: terminationBlock
    | result |
    result := self ifCurtailed: terminationBlock.
    terminationBlock value.
    ^result!
Annotation key: 'category' value: 'exception handling'!

Block method!
numArgs ^self argumentCount!
Annotation key: 'category' value: 'accessing'!

Block method!
whileFalse ^[self value] whileFalse: []!
Annotation key: 'category' value: 'control'!

Block method!
whileFalse: body ^[self value not] whileTrue: body!
Annotation key: 'category' value: 'control'!

Block method!
whileTrue ^[self value] whileTrue: []!
Annotation key: 'category' value: 'control'!

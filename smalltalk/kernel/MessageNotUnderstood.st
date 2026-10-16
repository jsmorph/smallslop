Smalltalk interchangeVersion: '1.0'!
Class named: 'MessageNotUnderstood'
  superclass: 'Error'
  indexedInstanceVariables: #none
  instanceVariableNames: 'message receiver'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Exceptions'!

MessageNotUnderstood method!
description
    ^self messageText isNil
      ifTrue: [receiver class name, ' does not understand ', message selector, '.']
      ifFalse: [self messageText]!
Annotation key: 'category' value: 'exception description'!

MessageNotUnderstood method!
isResumable ^true!
Annotation key: 'category' value: 'exception description'!

MessageNotUnderstood method!
message ^message!
Annotation key: 'category' value: 'accessing'!

MessageNotUnderstood method!
message: aMessage receiver: anObject message := aMessage. receiver := anObject!
Annotation key: 'category' value: 'accessing'!

MessageNotUnderstood method!
receiver ^receiver!
Annotation key: 'category' value: 'accessing'!

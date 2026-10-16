Smalltalk interchangeVersion: '1.0'!
Class named: 'Message'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'selector arguments'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Exceptions'!

Message method!
arguments ^arguments!
Annotation key: 'category' value: 'accessing'!

Message method!
printOn: aStream aStream nextPutAll: selector; nextPutAll: ' '; print: arguments!
Annotation key: 'category' value: 'printing'!

Message method!
selector ^selector!
Annotation key: 'category' value: 'accessing'!

Message method!
setSelector: aSelector arguments: anArray selector := aSelector. arguments := anArray!
Annotation key: 'category' value: 'private'!

Message classMethod!
selector: aSelector arguments: anArray ^self new setSelector: aSelector arguments: anArray!
Annotation key: 'category' value: 'instance creation'!

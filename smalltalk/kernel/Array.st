Smalltalk interchangeVersion: '1.0'!
Class named: 'Array'
  superclass: 'ArrayedCollection'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Sequenceable'!

Array method!
isArray ^true!
Annotation key: 'category' value: 'testing'!

Array method!
printOn: aStream
      aStream nextPutAll: '#('.
      self do: [:each | each printOn: aStream] separatedBy: [aStream space].
      aStream nextPut: $)!
Annotation key: 'category' value: 'printing'!

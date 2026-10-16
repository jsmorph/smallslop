Smalltalk interchangeVersion: '1.0'!
Class named: 'ArrayedCollection'
  superclass: 'SequenceableCollection'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Abstract'!

ArrayedCollection classMethod!
new ^self new: 0!
Annotation key: 'category' value: 'instance creation'!

ArrayedCollection classMethod!
with: a ^(self new: 1) at: 1 put: a; yourself!
Annotation key: 'category' value: 'instance creation'!

ArrayedCollection classMethod!
with: a with: b ^(self new: 2) at: 1 put: a; at: 2 put: b; yourself!
Annotation key: 'category' value: 'instance creation'!

ArrayedCollection classMethod!
with: a with: b with: c ^(self new: 3) at: 1 put: a; at: 2 put: b; at: 3 put: c; yourself!
Annotation key: 'category' value: 'instance creation'!

ArrayedCollection classMethod!
with: a with: b with: c with: d ^(self new: 4) at: 1 put: a; at: 2 put: b; at: 3 put: c; at: 4 put: d; yourself!
Annotation key: 'category' value: 'instance creation'!

ArrayedCollection classMethod!
withAll: aCollection
        | result index |
        result := self new: aCollection size.
        index := 0.
        aCollection do: [:each | index := index + 1. result at: index put: each].
        ^result!
Annotation key: 'category' value: 'instance creation'!

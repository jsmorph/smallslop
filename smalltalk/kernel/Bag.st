Smalltalk interchangeVersion: '1.0'!
Class named: 'Bag'
  superclass: 'Collection'
  indexedInstanceVariables: #none
  instanceVariableNames: 'contents'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Unordered'!

Bag method!
add: anObject ^self add: anObject withOccurrences: 1!
Annotation key: 'category' value: 'adding'!

Bag method!
add: anObject withOccurrences: anInteger
        contents at: anObject put: (contents at: anObject ifAbsent: [0]) + anInteger.
        ^anObject!
Annotation key: 'category' value: 'adding'!

Bag method!
collect: aBlock
        | result |
        result := Bag new.
        self do: [:each | result add: (aBlock value: each)].
        ^result!
Annotation key: 'category' value: 'enumerating'!

Bag method!
copy ^Bag new addAll: self; yourself!
Annotation key: 'category' value: 'copying'!

Bag method!
do: aBlock contents keysAndValuesDo: [:each :count | count timesRepeat: [aBlock value: each]]!
Annotation key: 'category' value: 'enumerating'!

Bag method!
includes: anObject ^contents includesKey: anObject!
Annotation key: 'category' value: 'testing'!

Bag method!
occurrencesOf: anObject ^contents at: anObject ifAbsent: [0]!
Annotation key: 'category' value: 'testing'!

Bag method!
rehash contents rehash!
Annotation key: 'category' value: 'copying'!

Bag method!
remove: oldObject ifAbsent: exceptionBlock
      | count |
      count := contents at: oldObject ifAbsent: [^exceptionBlock value].
      count = 1 ifTrue: [contents removeKey: oldObject] ifFalse: [contents at: oldObject put: count - 1].
      ^oldObject!
Annotation key: 'category' value: 'removing'!

Bag method!
setContents: aDictionary contents := aDictionary!
Annotation key: 'category' value: 'private'!

Bag method!
size ^contents inject: 0 into: [:sum :count | sum + count]!
Annotation key: 'category' value: 'accessing'!

Bag classMethod!
new ^self basicNew setContents: Dictionary new!
Annotation key: 'category' value: 'instance creation'!

Bag classMethod!
new: capacity ^self new!
Annotation key: 'category' value: 'instance creation'!

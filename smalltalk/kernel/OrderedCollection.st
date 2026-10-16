Smalltalk interchangeVersion: '1.0'!
Class named: 'OrderedCollection'
  superclass: 'SequenceableCollection'
  indexedInstanceVariables: #none
  instanceVariableNames: 'items'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Sequenceable'!

OrderedCollection method!
add: anObject ^self addLast: anObject!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
add: newObject after: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self add: newObject beforeIndex: index + 1!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
add: newObject afterIndex: index ^self add: newObject beforeIndex: index + 1!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
add: newObject before: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self add: newObject beforeIndex: index!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
addAll: aCollection after: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self addAll: aCollection beforeIndex: index + 1!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
addAll: aCollection afterIndex: index ^self addAll: aCollection beforeIndex: index + 1!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
addAll: aCollection before: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self addAll: aCollection beforeIndex: index!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
addAll: aCollection beforeIndex: index
        | position |
        position := index.
        aCollection do: [:each | self add: each beforeIndex: position. position := position + 1].
        ^aCollection!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
addAllFirst: aCollection ^self addAll: aCollection beforeIndex: 1!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
addAllLast: aCollection aCollection do: [:each | self addLast: each]. ^aCollection!
Annotation key: 'category' value: 'adding'!

OrderedCollection method!
remove: oldObject ifAbsent: exceptionBlock
      | index |
      index := self indexOf: oldObject.
      index = 0 ifTrue: [^exceptionBlock value].
      ^self removeAtIndex: index!
Annotation key: 'category' value: 'removing'!

OrderedCollection classMethod!
new ^self basicNew initialize!
Annotation key: 'category' value: 'instance creation'!

OrderedCollection classMethod!
new: anInteger ^self new!
Annotation key: 'category' value: 'instance creation'!

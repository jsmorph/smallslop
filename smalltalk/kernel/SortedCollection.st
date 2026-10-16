Smalltalk interchangeVersion: '1.0'!
Class named: 'SortedCollection'
  superclass: 'OrderedCollection'
  indexedInstanceVariables: #none
  instanceVariableNames: 'sortBlock'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Sequenceable'!

SortedCollection method!
add: anObject
        | low high middle |
        low := 1.
        high := self size.
        [low <= high] whileTrue: [
          middle := (low + high) // 2.
          (sortBlock value: (self at: middle) value: anObject)
            ifTrue: [low := middle + 1]
            ifFalse: [high := middle - 1]].
        super add: anObject beforeIndex: low.
        ^anObject!
Annotation key: 'category' value: 'adding'!

SortedCollection method!
add: anObject beforeIndex: index ^self shouldNotImplement!
Annotation key: 'category' value: 'adding'!

SortedCollection method!
addFirst: anObject ^self shouldNotImplement!
Annotation key: 'category' value: 'adding'!

SortedCollection method!
addLast: anObject ^self shouldNotImplement!
Annotation key: 'category' value: 'adding'!

SortedCollection method!
asSortedCollection ^(SortedCollection sortBlock: sortBlock) addAll: self; yourself!
Annotation key: 'category' value: 'converting'!

SortedCollection method!
at: index put: anObject ^self shouldNotImplement!
Annotation key: 'category' value: 'adding'!

SortedCollection method!
resort
        | elements |
        elements := self asArray.
        self initialize.
        elements do: [:each | self add: each]!
Annotation key: 'category' value: 'private'!

SortedCollection method!
select: aBlock
        | result |
        result := SortedCollection sortBlock: sortBlock.
        self do: [:each | (aBlock value: each) ifTrue: [result add: each]].
        ^result!
Annotation key: 'category' value: 'enumerating'!

SortedCollection method!
setSortBlock: aBlock sortBlock := aBlock!
Annotation key: 'category' value: 'private'!

SortedCollection method!
sortBlock ^sortBlock!
Annotation key: 'category' value: 'accessing'!

SortedCollection method!
sortBlock: aBlock sortBlock := aBlock. self resort!
Annotation key: 'category' value: 'accessing'!

SortedCollection method!
species ^OrderedCollection!
Annotation key: 'category' value: 'copying'!

SortedCollection classMethod!
new ^self sortBlock: [:a :b | a <= b]!
Annotation key: 'category' value: 'instance creation'!

SortedCollection classMethod!
new: anInteger ^self new!
Annotation key: 'category' value: 'instance creation'!

SortedCollection classMethod!
sortBlock: aBlock ^self basicNew initialize; setSortBlock: aBlock; yourself!
Annotation key: 'category' value: 'instance creation'!

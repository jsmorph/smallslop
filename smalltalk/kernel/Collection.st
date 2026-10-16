Smalltalk interchangeVersion: '1.0'!
Class named: 'Collection'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Abstract'!

Collection method!
addAll: aCollection aCollection do: [:each | self add: each]. ^aCollection!
Annotation key: 'category' value: 'adding'!

Collection method!
allSatisfy: aBlock self do: [:each | (aBlock value: each) ifFalse: [^false]]. ^true!
Annotation key: 'category' value: 'testing'!

Collection method!
anySatisfy: aBlock self do: [:each | (aBlock value: each) ifTrue: [^true]]. ^false!
Annotation key: 'category' value: 'testing'!

Collection method!
asArray
        | stream |
        stream := WriteStream on: Array new.
        self do: [:each | stream nextPut: each].
        ^stream contents!
Annotation key: 'category' value: 'converting'!

Collection method!
asBag ^Bag new addAll: self; yourself!
Annotation key: 'category' value: 'converting'!

Collection method!
asOrderedCollection ^OrderedCollection new addAll: self; yourself!
Annotation key: 'category' value: 'converting'!

Collection method!
asSet ^Set new addAll: self; yourself!
Annotation key: 'category' value: 'converting'!

Collection method!
asSortedCollection ^self asSortedCollection: [:a :b | a <= b]!
Annotation key: 'category' value: 'converting'!

Collection method!
asSortedCollection: aBlock ^(SortedCollection sortBlock: aBlock) addAll: self; yourself!
Annotation key: 'category' value: 'converting'!

Collection method!
collect: aBlock
        | result |
        result := self species new.
        self do: [:each | result add: (aBlock value: each)].
        ^result!
Annotation key: 'category' value: 'enumerating'!

Collection method!
detect: aBlock ^self detect: aBlock ifNone: [self error: 'No element satisfies the condition.']!
Annotation key: 'category' value: 'enumerating'!

Collection method!
detect: aBlock ifNone: exceptionBlock self do: [:each | (aBlock value: each) ifTrue: [^each]]. ^exceptionBlock value!
Annotation key: 'category' value: 'enumerating'!

Collection method!
do: aBlock ^self subclassResponsibility!
Annotation key: 'category' value: 'enumerating'!

Collection method!
do: aBlock separatedBy: separatorBlock
        | first |
        first := true.
        self do: [:each | first ifFalse: [separatorBlock value]. first := false. aBlock value: each]!
Annotation key: 'category' value: 'enumerating'!

Collection method!
includes: anObject self do: [:each | each = anObject ifTrue: [^true]]. ^false!
Annotation key: 'category' value: 'testing'!

Collection method!
inject: initialValue into: aBlock
        | value |
        value := initialValue.
        self do: [:each | value := aBlock value: value value: each].
        ^value!
Annotation key: 'category' value: 'enumerating'!

Collection method!
isCollection ^true!
Annotation key: 'category' value: 'testing'!

Collection method!
isEmpty ^self size = 0!
Annotation key: 'category' value: 'testing'!

Collection method!
notEmpty ^self isEmpty not!
Annotation key: 'category' value: 'testing'!

Collection method!
occurrencesOf: anObject
        | count |
        count := 0.
        self do: [:each | each = anObject ifTrue: [count := count + 1]].
        ^count!
Annotation key: 'category' value: 'testing'!

Collection method!
printOn: aStream
      super printOn: aStream.
      aStream nextPut: $(.
      self do: [:each | each printOn: aStream] separatedBy: [aStream space].
      aStream nextPut: $)!
Annotation key: 'category' value: 'printing'!

Collection method!
rehash ^self!
Annotation key: 'category' value: 'copying'!

Collection method!
reject: aBlock ^self select: [:each | (aBlock value: each) not]!
Annotation key: 'category' value: 'enumerating'!

Collection method!
remove: oldObject ^self remove: oldObject ifAbsent: [self error: 'The object is not in the collection.']!
Annotation key: 'category' value: 'removing'!

Collection method!
removeAll: aCollection aCollection do: [:each | self remove: each]. ^aCollection!
Annotation key: 'category' value: 'removing'!

Collection method!
select: aBlock
        | result |
        result := self species new.
        self do: [:each | (aBlock value: each) ifTrue: [result add: each]].
        ^result!
Annotation key: 'category' value: 'enumerating'!

Collection method!
size
      | count |
      count := 0.
      self do: [:each | count := count + 1].
      ^count!
Annotation key: 'category' value: 'accessing'!

Collection method!
species ^self class!
Annotation key: 'category' value: 'copying'!

Collection classMethod!
with: a ^self new add: a; yourself!
Annotation key: 'category' value: 'instance creation'!

Collection classMethod!
with: a with: b ^self new add: a; add: b; yourself!
Annotation key: 'category' value: 'instance creation'!

Collection classMethod!
with: a with: b with: c ^self new add: a; add: b; add: c; yourself!
Annotation key: 'category' value: 'instance creation'!

Collection classMethod!
with: a with: b with: c with: d ^self new add: a; add: b; add: c; add: d; yourself!
Annotation key: 'category' value: 'instance creation'!

Collection classMethod!
withAll: aCollection ^self new addAll: aCollection; yourself!
Annotation key: 'category' value: 'instance creation'!

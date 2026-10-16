Smalltalk interchangeVersion: '1.0'!
Class named: 'Set'
  superclass: 'Collection'
  indexedInstanceVariables: #none
  instanceVariableNames: 'tally buckets'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Unordered'!

Set method!
add: newObject
      | bucket |
      bucket := self bucketFor: newObject.
      bucket do: [:each | (self is: each sameAs: newObject) ifTrue: [^newObject]].
      bucket add: newObject.
      tally := tally + 1.
      self growIfNeeded.
      ^newObject!
Annotation key: 'category' value: 'adding'!

Set method!
bucketFor: anObject
        | index bucket |
        index := self indexFor: anObject.
        bucket := buckets at: index.
        bucket isNil ifTrue: [bucket := OrderedCollection new. buckets at: index put: bucket].
        ^bucket!
Annotation key: 'category' value: 'private'!

Set method!
collect: aBlock
        | result |
        result := Set new.
        self do: [:each | result add: (aBlock value: each)].
        ^result!
Annotation key: 'category' value: 'enumerating'!

Set method!
copy ^self species new addAll: self; yourself!
Annotation key: 'category' value: 'copying'!

Set method!
do: aBlock buckets do: [:bucket | bucket isNil ifFalse: [bucket do: aBlock]]!
Annotation key: 'category' value: 'enumerating'!

Set method!
growIfNeeded tally * 4 > (buckets size * 3) ifTrue: [self rehashTo: buckets size * 2]!
Annotation key: 'category' value: 'private'!

Set method!
hashOf: anObject ^anObject hash!
Annotation key: 'category' value: 'private'!

Set method!
includes: anObject
      | bucket |
      bucket := buckets at: (self indexFor: anObject).
      bucket isNil ifTrue: [^false].
      bucket do: [:each | (self is: each sameAs: anObject) ifTrue: [^true]].
      ^false!
Annotation key: 'category' value: 'testing'!

Set method!
indexFor: anObject ^((self hashOf: anObject) \\ buckets size) + 1!
Annotation key: 'category' value: 'private'!

Set method!
initialize: capacity buckets := Array new: (capacity max: 8). tally := 0!
Annotation key: 'category' value: 'private'!

Set method!
is: a sameAs: b ^a = b!
Annotation key: 'category' value: 'private'!

Set method!
rehash self rehashTo: buckets size!
Annotation key: 'category' value: 'copying'!

Set method!
rehashTo: capacity
        | old |
        old := buckets.
        buckets := Array new: capacity.
        tally := 0.
        old do: [:bucket | bucket isNil ifFalse: [bucket do: [:each | self add: each]]]!
Annotation key: 'category' value: 'private'!

Set method!
remove: oldObject ifAbsent: exceptionBlock
      | bucket |
      bucket := buckets at: (self indexFor: oldObject).
      bucket isNil ifFalse: [
        1 to: bucket size do: [:index |
          (self is: (bucket at: index) sameAs: oldObject) ifTrue: [
            bucket removeAtIndex: index.
            tally := tally - 1.
            ^oldObject]]].
      ^exceptionBlock value!
Annotation key: 'category' value: 'removing'!

Set method!
size ^tally!
Annotation key: 'category' value: 'accessing'!

Set classMethod!
new ^self new: 16!
Annotation key: 'category' value: 'instance creation'!

Set classMethod!
new: capacity ^self basicNew initialize: capacity!
Annotation key: 'category' value: 'instance creation'!

Smalltalk interchangeVersion: '1.0'!
Class named: 'Dictionary'
  superclass: 'Collection'
  indexedInstanceVariables: #none
  instanceVariableNames: 'tally buckets'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Unordered'!

Dictionary method!
addAll: aDictionary aDictionary keysAndValuesDo: [:key :value | self at: key put: value]. ^aDictionary!
Annotation key: 'category' value: 'adding'!

Dictionary method!
associationAt: aKey ifAbsent: exceptionBlock
        | bucket |
        bucket := buckets at: (self indexFor: aKey).
        bucket isNil ifTrue: [^exceptionBlock value].
        bucket do: [:association | (self is: association key sameAs: aKey) ifTrue: [^association]].
        ^exceptionBlock value!
Annotation key: 'category' value: 'private'!

Dictionary method!
associationsDo: aBlock buckets do: [:bucket | bucket isNil ifFalse: [bucket do: aBlock]]!
Annotation key: 'category' value: 'enumerating'!

Dictionary method!
at: aKey ^self at: aKey ifAbsent: [self error: 'Key not found: ', aKey printString]!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
at: aKey ifAbsent: exceptionBlock ^(self associationAt: aKey ifAbsent: [^exceptionBlock value]) value!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
at: aKey ifAbsentPut: aBlock ^self at: aKey ifAbsent: [self at: aKey put: aBlock value]!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
at: aKey put: aValue
        | association index bucket |
        association := self associationAt: aKey ifAbsent: [nil].
        association isNil ifFalse: [association value: aValue. ^aValue].
        index := self indexFor: aKey.
        bucket := buckets at: index.
        bucket isNil ifTrue: [bucket := OrderedCollection new. buckets at: index put: bucket].
        bucket add: (Association key: aKey value: aValue).
        tally := tally + 1.
        self growIfNeeded.
        ^aValue!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
collect: aBlock
        | result |
        result := self species new.
        self keysAndValuesDo: [:key :value | result at: key put: (aBlock value: value)].
        ^result!
Annotation key: 'category' value: 'enumerating'!

Dictionary method!
copy ^self species new addAll: self; yourself!
Annotation key: 'category' value: 'copying'!

Dictionary method!
do: aBlock self associationsDo: [:association | aBlock value: association value]!
Annotation key: 'category' value: 'enumerating'!

Dictionary method!
growIfNeeded tally * 4 > (buckets size * 3) ifTrue: [self rehashTo: buckets size * 2]!
Annotation key: 'category' value: 'private'!

Dictionary method!
hashOf: aKey ^aKey hash!
Annotation key: 'category' value: 'private'!

Dictionary method!
includesKey: aKey self associationAt: aKey ifAbsent: [^false]. ^true!
Annotation key: 'category' value: 'testing'!

Dictionary method!
indexFor: aKey ^((self hashOf: aKey) \\ buckets size) + 1!
Annotation key: 'category' value: 'private'!

Dictionary method!
initialize: capacity buckets := Array new: (capacity max: 8). tally := 0!
Annotation key: 'category' value: 'private'!

Dictionary method!
is: a sameAs: b ^a = b!
Annotation key: 'category' value: 'private'!

Dictionary method!
keyAtValue: aValue ^self keyAtValue: aValue ifAbsent: [nil]!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
keyAtValue: aValue ifAbsent: exceptionBlock self keysAndValuesDo: [:key :value | value = aValue ifTrue: [^key]]. ^exceptionBlock value!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
keys
        | result |
        result := Set new.
        self keysDo: [:each | result add: each].
        ^result!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
keysAndValuesDo: aBlock self associationsDo: [:association | aBlock value: association key value: association value]!
Annotation key: 'category' value: 'enumerating'!

Dictionary method!
keysDo: aBlock self associationsDo: [:association | aBlock value: association key]!
Annotation key: 'category' value: 'enumerating'!

Dictionary method!
printOn: aStream
      | first |
      aStream nextPutAll: self class name; nextPut: $(.
      first := true.
      self associationsDo: [:association | first ifFalse: [aStream space]. first := false. association printOn: aStream].
      aStream nextPut: $)!
Annotation key: 'category' value: 'printing'!

Dictionary method!
rehash self rehashTo: buckets size!
Annotation key: 'category' value: 'copying'!

Dictionary method!
rehashTo: capacity
        | old |
        old := buckets.
        buckets := Array new: capacity.
        tally := 0.
        old do: [:bucket | bucket isNil ifFalse: [bucket do: [:association | self at: association key put: association value]]]!
Annotation key: 'category' value: 'private'!

Dictionary method!
removeAllKeys: keys keys do: [:each | self removeKey: each]!
Annotation key: 'category' value: 'removing'!

Dictionary method!
removeAllKeys: keys ifAbsent: exceptionBlock keys do: [:each | self removeKey: each ifAbsent: exceptionBlock]!
Annotation key: 'category' value: 'removing'!

Dictionary method!
removeKey: aKey ^self removeKey: aKey ifAbsent: [self error: 'Key not found: ', aKey printString]!
Annotation key: 'category' value: 'removing'!

Dictionary method!
removeKey: aKey ifAbsent: exceptionBlock
        | bucket |
        bucket := buckets at: (self indexFor: aKey).
        bucket isNil ifFalse: [
          1 to: bucket size do: [:index |
            | association |
            association := bucket at: index.
            (self is: association key sameAs: aKey) ifTrue: [
              bucket removeAtIndex: index.
              tally := tally - 1.
              ^association value]]].
        ^exceptionBlock value!
Annotation key: 'category' value: 'removing'!

Dictionary method!
select: aBlock
        | result |
        result := self species new.
        self keysAndValuesDo: [:key :value | (aBlock value: value) ifTrue: [result at: key put: value]].
        ^result!
Annotation key: 'category' value: 'enumerating'!

Dictionary method!
size ^tally!
Annotation key: 'category' value: 'accessing'!

Dictionary method!
values
        | stream |
        stream := WriteStream on: Array new.
        self do: [:each | stream nextPut: each].
        ^stream contents!
Annotation key: 'category' value: 'accessing'!

Dictionary classMethod!
new ^self new: 16!
Annotation key: 'category' value: 'instance creation'!

Dictionary classMethod!
new: capacity ^self basicNew initialize: capacity!
Annotation key: 'category' value: 'instance creation'!

Dictionary classMethod!
withAll: aDictionary ^self new addAll: aDictionary; yourself!
Annotation key: 'category' value: 'instance creation'!

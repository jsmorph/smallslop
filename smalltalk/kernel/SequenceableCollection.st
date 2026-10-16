Smalltalk interchangeVersion: '1.0'!
Class named: 'SequenceableCollection'
  superclass: 'Collection'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Abstract'!

SequenceableCollection method!
, aCollection
        | stream |
        stream := self newWriteStream.
        self do: [:each | stream nextPut: each].
        aCollection do: [:each | stream nextPut: each].
        ^stream contents!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
= aCollection
        self class == aCollection class ifFalse: [^false].
        self size = aCollection size ifFalse: [^false].
        1 to: self size do: [:index | (self at: index) = (aCollection at: index) ifFalse: [^false]].
        ^true!
Annotation key: 'category' value: 'comparing'!

SequenceableCollection method!
after: target
        | index |
        index := self indexOf: target.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        index = self size ifTrue: [^self error: 'The object is the last element.'].
        ^self at: index + 1!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
at: index ifAbsent: exceptionBlock
        ^(index between: 1 and: self size) ifTrue: [self at: index] ifFalse: [exceptionBlock value]!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
atAll: indices put: anObject indices do: [:index | self at: index put: anObject]. ^anObject!
Annotation key: 'category' value: 'replacing'!

SequenceableCollection method!
atAllPut: anObject 1 to: self size do: [:index | self at: index put: anObject]. ^anObject!
Annotation key: 'category' value: 'replacing'!

SequenceableCollection method!
before: target
        | index |
        index := self indexOf: target.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        index = 1 ifTrue: [^self error: 'The object is the first element.'].
        ^self at: index - 1!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
collect: aBlock
        | stream |
        stream := self newWriteStream.
        self do: [:each | stream nextPut: (aBlock value: each)].
        ^stream contents!
Annotation key: 'category' value: 'enumerating'!

SequenceableCollection method!
copyFrom: start to: stop
        | stream |
        stream := self newWriteStream.
        start to: stop do: [:index | stream nextPut: (self at: index)].
        ^stream contents!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
copyReplaceAll: oldSubCollection with: newSubCollection
        | stream index next |
        oldSubCollection isEmpty ifTrue: [^self copyFrom: 1 to: self size].
        stream := self newWriteStream.
        index := 1.
        [next := self indexOfSubCollection: oldSubCollection startingAt: index.
         next > 0] whileTrue: [
          index to: next - 1 do: [:position | stream nextPut: (self at: position)].
          newSubCollection do: [:each | stream nextPut: each].
          index := next + oldSubCollection size].
        index to: self size do: [:position | stream nextPut: (self at: position)].
        ^stream contents!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
copyReplaceFrom: start to: stop with: replacement
        | stream |
        stream := self newWriteStream.
        1 to: start - 1 do: [:index | stream nextPut: (self at: index)].
        replacement do: [:each | stream nextPut: each].
        stop + 1 to: self size do: [:index | stream nextPut: (self at: index)].
        ^stream contents!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
copyReplaceFrom: start to: stop withObject: replacementElement
        | stream |
        stream := self newWriteStream.
        1 to: self size do: [:index |
          stream nextPut: ((index between: start and: stop) ifTrue: [replacementElement] ifFalse: [self at: index])].
        ^stream contents!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
copyReplacing: oldElement withObject: newElement ^self collect: [:each | each = oldElement ifTrue: [newElement] ifFalse: [each]]!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
copyWith: newElement
        | stream |
        stream := self newWriteStream.
        self do: [:each | stream nextPut: each].
        stream nextPut: newElement.
        ^stream contents!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
copyWithout: oldElement ^self reject: [:each | each = oldElement]!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
do: aBlock 1 to: self size do: [:index | aBlock value: (self at: index)]!
Annotation key: 'category' value: 'enumerating'!

SequenceableCollection method!
findFirst: aBlock
        1 to: self size do: [:index | (aBlock value: (self at: index)) ifTrue: [^index]].
        ^0!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
findLast: aBlock
        self size to: 1 by: -1 do: [:index | (aBlock value: (self at: index)) ifTrue: [^index]].
        ^0!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
first ^self isEmpty ifTrue: [self error: 'The collection is empty.'] ifFalse: [self at: 1]!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
from: start to: stop do: aBlock start to: stop do: [:index | aBlock value: (self at: index)]!
Annotation key: 'category' value: 'enumerating'!

SequenceableCollection method!
from: start to: stop keysAndValuesDo: aBlock start to: stop do: [:index | aBlock value: index value: (self at: index)]!
Annotation key: 'category' value: 'enumerating'!

SequenceableCollection method!
hash
        | value |
        value := self size hash.
        self do: [:each | value := value bitXor: each hash].
        ^value!
Annotation key: 'category' value: 'comparing'!

SequenceableCollection method!
includes: anObject ^(self indexOf: anObject) > 0!
Annotation key: 'category' value: 'testing'!

SequenceableCollection method!
indexOf: anElement ^self indexOf: anElement ifAbsent: [0]!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
indexOf: anElement ifAbsent: exceptionBlock
        1 to: self size do: [:index | (self at: index) = anElement ifTrue: [^index]].
        ^exceptionBlock value!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
indexOfSubCollection: aSubCollection startingAt: start
        ^self indexOfSubCollection: aSubCollection startingAt: start ifAbsent: [0]!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
indexOfSubCollection: aSubCollection startingAt: start ifAbsent: exceptionBlock
        start to: self size - aSubCollection size + 1 do: [:index |
          | match |
          match := true.
          1 to: aSubCollection size do: [:offset |
            (self at: index + offset - 1) = (aSubCollection at: offset) ifFalse: [match := false]].
          match ifTrue: [^index]].
        ^exceptionBlock value!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
isEmpty ^self size = 0!
Annotation key: 'category' value: 'testing'!

SequenceableCollection method!
keysAndValuesDo: aBlock 1 to: self size do: [:index | aBlock value: index value: (self at: index)]!
Annotation key: 'category' value: 'enumerating'!

SequenceableCollection method!
last ^self isEmpty ifTrue: [self error: 'The collection is empty.'] ifFalse: [self at: self size]!
Annotation key: 'category' value: 'accessing'!

SequenceableCollection method!
newWriteStream ^WriteStream on: self species new!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
replaceFrom: start to: stop with: replacement ^self replaceFrom: start to: stop with: replacement startingAt: 1!
Annotation key: 'category' value: 'replacing'!

SequenceableCollection method!
replaceFrom: start to: stop with: replacement startingAt: repStart
        | source |
        source := repStart.
        start to: stop do: [:index | self at: index put: (replacement at: source). source := source + 1]!
Annotation key: 'category' value: 'replacing'!

SequenceableCollection method!
replaceFrom: start to: stop withObject: anObject start to: stop do: [:index | self at: index put: anObject]!
Annotation key: 'category' value: 'replacing'!

SequenceableCollection method!
reverse
        | stream |
        stream := self newWriteStream.
        self reverseDo: [:each | stream nextPut: each].
        ^stream contents!
Annotation key: 'category' value: 'copying'!

SequenceableCollection method!
reverseDo: aBlock self size to: 1 by: -1 do: [:index | aBlock value: (self at: index)]!
Annotation key: 'category' value: 'enumerating'!

SequenceableCollection method!
select: aBlock
        | stream |
        stream := self newWriteStream.
        self do: [:each | (aBlock value: each) ifTrue: [stream nextPut: each]].
        ^stream contents!
Annotation key: 'category' value: 'enumerating'!

SequenceableCollection method!
with: aCollection do: aBlock
        self size = aCollection size ifFalse: [^self error: 'The collections must have the same size.'].
        1 to: self size do: [:index | aBlock value: (self at: index) value: (aCollection at: index)]!
Annotation key: 'category' value: 'enumerating'!

Smalltalk interchangeVersion: '1.0'!
Class named: 'ReadStream'
  superclass: 'Stream'
  indexedInstanceVariables: #none
  instanceVariableNames: 'collection position limit'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Streams'!

ReadStream method!
atEnd ^position >= limit!
Annotation key: 'category' value: 'testing'!

ReadStream method!
close ^self!
Annotation key: 'category' value: 'closing'!

ReadStream method!
contents ^collection copyFrom: 1 to: limit!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
do: aBlock [self atEnd] whileFalse: [aBlock value: self next]!
Annotation key: 'category' value: 'enumerating'!

ReadStream method!
isEmpty ^limit = 0!
Annotation key: 'category' value: 'testing'!

ReadStream method!
next
        self atEnd ifTrue: [^self error: 'The stream is at its end.'].
        position := position + 1.
        ^collection at: position!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
next: anInteger
        | stream |
        stream := WriteStream on: collection species new.
        anInteger timesRepeat: [stream nextPut: self next].
        ^stream contents!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
nextLine
        | line |
        line := self upTo: Character lf.
        ^(line notEmpty and: [line last = Character cr]) ifTrue: [line copyFrom: 1 to: line size - 1] ifFalse: [line]!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
nextMatchFor: anObject ^self next = anObject!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
peek ^self atEnd ifTrue: [nil] ifFalse: [collection at: position + 1]!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
peekFor: anObject (self atEnd not and: [self peek = anObject]) ifTrue: [position := position + 1. ^true]. ^false!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
position ^position!
Annotation key: 'category' value: 'positioning'!

ReadStream method!
position: anInteger
        (anInteger between: 0 and: limit) ifFalse: [^self error: 'The position is outside the stream.'].
        position := anInteger!
Annotation key: 'category' value: 'positioning'!

ReadStream method!
reset position := 0!
Annotation key: 'category' value: 'positioning'!

ReadStream method!
setCollection: aCollection collection := aCollection. position := 0. limit := aCollection size!
Annotation key: 'category' value: 'private'!

ReadStream method!
setToEnd position := limit!
Annotation key: 'category' value: 'positioning'!

ReadStream method!
skip: anInteger position := ((position + anInteger) max: 0) min: limit!
Annotation key: 'category' value: 'positioning'!

ReadStream method!
skipTo: anObject [self atEnd] whileFalse: [self next = anObject ifTrue: [^true]]. ^false!
Annotation key: 'category' value: 'positioning'!

ReadStream method!
upTo: anObject
        | stream |
        stream := WriteStream on: collection species new.
        [self atEnd] whileFalse: [
          | element |
          element := self next.
          element = anObject ifTrue: [^stream contents].
          stream nextPut: element].
        ^stream contents!
Annotation key: 'category' value: 'accessing'!

ReadStream method!
upToEnd
        | stream |
        stream := WriteStream on: collection species new.
        [self atEnd] whileFalse: [stream nextPut: self next].
        ^stream contents!
Annotation key: 'category' value: 'accessing'!

ReadStream classMethod!
on: aCollection ^self basicNew setCollection: aCollection!
Annotation key: 'category' value: 'instance creation'!

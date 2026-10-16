Smalltalk interchangeVersion: '1.0'!
Class named: 'Interval'
  superclass: 'SequenceableCollection'
  indexedInstanceVariables: #none
  instanceVariableNames: 'start stop step'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Collections-Sequenceable'!

Interval method!
at: index
        (index between: 1 and: self size) ifFalse: [^self error: 'Index ', index printString, ' is outside 1 through ', self size printString, '.'].
        ^start + (step isFloat ifTrue: [(index - 1) asFloat * step] ifFalse: [(index - 1) * step])!
Annotation key: 'category' value: 'accessing'!

Interval method!
do: aBlock
      | value |
      value := start.
      step strictlyPositive
        ifTrue: [[value <= stop] whileTrue: [aBlock value: value. value := value + step]]
        ifFalse: [[value >= stop] whileTrue: [aBlock value: value. value := value + step]]!
Annotation key: 'category' value: 'enumerating'!

Interval method!
first ^self isEmpty ifTrue: [self error: 'The collection is empty.'] ifFalse: [start]!
Annotation key: 'category' value: 'accessing'!

Interval method!
printOn: aStream
      aStream nextPut: $(; nextPutAll: start printString; nextPutAll: ' to: '; nextPutAll: stop printString.
      step = 1 ifFalse: [aStream nextPutAll: ' by: '; nextPutAll: step printString].
      aStream nextPut: $)!
Annotation key: 'category' value: 'printing'!

Interval method!
setFrom: first to: last by: increment
      (increment = (increment - increment)) ifTrue: [^self error: 'The step must not be zero.'].
      start := first. stop := last. step := increment!
Annotation key: 'category' value: 'private'!

Interval method!
size
        step strictlyPositive
          ifTrue: [stop < start ifTrue: [^0]. ^(stop - start) // step + 1]
          ifFalse: [start < stop ifTrue: [^0]. ^(start - stop) // step negated + 1]!
Annotation key: 'category' value: 'accessing'!

Interval method!
species ^Array!
Annotation key: 'category' value: 'copying'!

Interval classMethod!
from: start to: stop ^self from: start to: stop by: 1!
Annotation key: 'category' value: 'instance creation'!

Interval classMethod!
from: start to: stop by: step ^self basicNew setFrom: start to: stop by: step!
Annotation key: 'category' value: 'instance creation'!

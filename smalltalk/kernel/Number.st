Smalltalk interchangeVersion: '1.0'!
Class named: 'Number'
  superclass: 'Magnitude'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Numbers'!

Number method!
// aNumber ^(self / aNumber) floor!
Annotation key: 'category' value: 'arithmetic'!

Number method!
\\ aNumber ^self - (self // aNumber * aNumber)!
Annotation key: 'category' value: 'arithmetic'!

Number method!
abs ^self negative ifTrue: [self negated] ifFalse: [self]!
Annotation key: 'category' value: 'arithmetic'!

Number method!
asFloatD ^self asFloat!
Annotation key: 'category' value: 'converting'!

Number method!
asFloatE ^self asFloat!
Annotation key: 'category' value: 'converting'!

Number method!
asFloatQ ^self asFloat!
Annotation key: 'category' value: 'converting'!

Number method!
asInteger ^self rounded!
Annotation key: 'category' value: 'truncation and rounding'!

Number method!
asString ^self printString!
Annotation key: 'category' value: 'printing'!

Number method!
even ^(self \\ 2) = 0!
Annotation key: 'category' value: 'testing'!

Number method!
fractionPart ^self - self integerPart!
Annotation key: 'category' value: 'truncation and rounding'!

Number method!
integerPart ^self truncated!
Annotation key: 'category' value: 'truncation and rounding'!

Number method!
isNumber ^true!
Annotation key: 'category' value: 'testing'!

Number method!
isZero ^self = (self - self)!
Annotation key: 'category' value: 'testing'!

Number method!
negative ^self < (self - self)!
Annotation key: 'category' value: 'testing'!

Number method!
odd ^self even not!
Annotation key: 'category' value: 'testing'!

Number method!
positive ^self >= (self - self)!
Annotation key: 'category' value: 'testing'!

Number method!
printOn: aStream aStream nextPutAll: self printString!
Annotation key: 'category' value: 'printing'!

Number method!
quo: aNumber ^(self / aNumber) truncated!
Annotation key: 'category' value: 'arithmetic'!

Number method!
raisedTo: aNumber
        aNumber isInteger ifTrue: [^self raisedToInteger: aNumber].
        ^self error: 'raisedTo: with a non-Integer exponent requires Float operands. Convert with asFloat.'!
Annotation key: 'category' value: 'mathematical functions'!

Number method!
raisedToInteger: anInteger
        | result base exponent |
        anInteger negative ifTrue: [^(self raisedToInteger: anInteger negated) reciprocal].
        anInteger = 0 ifTrue: [^self isFloat ifTrue: [1.0] ifFalse: [1]].
        base := self. exponent := anInteger.
        [exponent > 0] whileTrue: [
          exponent odd ifTrue: [result := result isNil ifTrue: [base] ifFalse: [result * base]].
          exponent := exponent // 2.
          exponent > 0 ifTrue: [base := base * base]].
        ^result!
Annotation key: 'category' value: 'mathematical functions'!

Number method!
reciprocal ^1 / self!
Annotation key: 'category' value: 'arithmetic'!

Number method!
rem: aNumber ^self - ((self quo: aNumber) * aNumber)!
Annotation key: 'category' value: 'arithmetic'!

Number method!
roundTo: aNumber ^(self / aNumber) rounded * aNumber!
Annotation key: 'category' value: 'truncation and rounding'!

Number method!
sign ^self strictlyPositive ifTrue: [1] ifFalse: [self negative ifTrue: [-1] ifFalse: [0]]!
Annotation key: 'category' value: 'arithmetic'!

Number method!
sqrt ^self asFloat sqrt!
Annotation key: 'category' value: 'mathematical functions'!

Number method!
squared ^self * self!
Annotation key: 'category' value: 'arithmetic'!

Number method!
strictlyPositive ^self > (self - self)!
Annotation key: 'category' value: 'testing'!

Number method!
to: stop ^Interval from: self to: stop!
Annotation key: 'category' value: 'intervals'!

Number method!
to: stop by: step ^Interval from: self to: stop by: step!
Annotation key: 'category' value: 'intervals'!

Number method!
to: stop by: step do: aBlock
        | value |
        step isZero ifTrue: [^self error: 'The step must not be zero.'].
        value := self.
        step strictlyPositive
          ifTrue: [[value <= stop] whileTrue: [aBlock value: value. value := value + step]]
          ifFalse: [[value >= stop] whileTrue: [aBlock value: value. value := value + step]]!
Annotation key: 'category' value: 'intervals'!

Number method!
to: stop do: aBlock
        | value |
        value := self.
        [value <= stop] whileTrue: [aBlock value: value. value := value + 1]!
Annotation key: 'category' value: 'intervals'!

Number method!
truncateTo: aNumber ^(self quo: aNumber) * aNumber!
Annotation key: 'category' value: 'truncation and rounding'!

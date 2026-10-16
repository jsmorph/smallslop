Smalltalk interchangeVersion: '1.0'!
Class named: 'Integer'
  superclass: 'Number'
  indexedInstanceVariables: #none
  instanceVariableNames: ''
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Numbers'!

Integer method!
allMask: mask ^(self bitAnd: mask) = mask!
Annotation key: 'category' value: 'bit manipulation'!

Integer method!
anyMask: mask ^(self bitAnd: mask) ~= 0!
Annotation key: 'category' value: 'bit manipulation'!

Integer method!
asFraction ^self!
Annotation key: 'category' value: 'truncation and rounding'!

Integer method!
asInteger ^self!
Annotation key: 'category' value: 'truncation and rounding'!

Integer method!
bitAt: index put: bit
        | mask |
        mask := 1 bitShift: index - 1.
        ^bit = 0 ifTrue: [self bitAnd: -1 - mask] ifFalse: [self bitOr: mask]!
Annotation key: 'category' value: 'bit manipulation'!

Integer method!
ceiling ^self!
Annotation key: 'category' value: 'truncation and rounding'!

Integer method!
factorial
        | result |
        self negative ifTrue: [^self error: 'factorial requires a nonnegative Integer.'].
        result := 1.
        2 to: self do: [:each | result := result * each].
        ^result!
Annotation key: 'category' value: 'arithmetic'!

Integer method!
floor ^self!
Annotation key: 'category' value: 'truncation and rounding'!

Integer method!
isInteger ^true!
Annotation key: 'category' value: 'testing'!

Integer method!
lcm: anInteger (self = 0 or: [anInteger = 0]) ifTrue: [^0]. ^(self * anInteger) abs // (self gcd: anInteger)!
Annotation key: 'category' value: 'arithmetic'!

Integer method!
noMask: mask ^(self bitAnd: mask) = 0!
Annotation key: 'category' value: 'bit manipulation'!

Integer method!
printOn: aStream base: radix showRadix: flag
        | text |
        text := self printStringRadix: radix.
        flag ifFalse: [
          text := self negative
            ifTrue: ['-', (text copyFrom: (text indexOf: $r) + 1 to: text size)]
            ifFalse: [text copyFrom: (text indexOf: $r) + 1 to: text size]].
        aStream nextPutAll: text!
Annotation key: 'category' value: 'printing'!

Integer method!
rounded ^self!
Annotation key: 'category' value: 'truncation and rounding'!

Integer method!
timesRepeat: aBlock
      | count |
      count := 1.
      [count <= self] whileTrue: [aBlock value. count := count + 1]!
Annotation key: 'category' value: 'enumerating'!

Integer method!
truncated ^self!
Annotation key: 'category' value: 'truncation and rounding'!

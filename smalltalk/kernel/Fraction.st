Smalltalk interchangeVersion: '1.0'!
Class named: 'Fraction'
  superclass: 'Number'
  indexedInstanceVariables: #none
  instanceVariableNames: 'numerator denominator'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Kernel-Numbers'!

Fraction method!
- aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber denominator - (aNumber numerator * denominator)
          denominator: denominator * aNumber denominator!
Annotation key: 'category' value: 'arithmetic'!

Fraction method!
* aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber numerator denominator: denominator * aNumber denominator!
Annotation key: 'category' value: 'arithmetic'!

Fraction method!
/ aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber denominator denominator: denominator * aNumber numerator!
Annotation key: 'category' value: 'arithmetic'!

Fraction method!
+ aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber denominator + (aNumber numerator * denominator)
          denominator: denominator * aNumber denominator!
Annotation key: 'category' value: 'arithmetic'!

Fraction method!
< aNumber self checkExact: aNumber. ^numerator * aNumber denominator < (aNumber numerator * denominator)!
Annotation key: 'category' value: 'comparing'!

Fraction method!
= anObject ^(anObject isKindOf: Fraction) and: [numerator = anObject numerator and: [denominator = anObject denominator]]!
Annotation key: 'category' value: 'comparing'!

Fraction method!
asFloat ^numerator asFloat / denominator asFloat!
Annotation key: 'category' value: 'converting'!

Fraction method!
asFraction ^self!
Annotation key: 'category' value: 'truncation and rounding'!

Fraction method!
ceiling ^(numerator + denominator - 1) // denominator!
Annotation key: 'category' value: 'truncation and rounding'!

Fraction method!
checkExact: aNumber
        (aNumber isInteger or: [aNumber isFraction]) ifFalse: [
          self error: 'Fraction arithmetic requires an Integer or Fraction. Convert Floats with asFloat.']!
Annotation key: 'category' value: 'arithmetic'!

Fraction method!
denominator ^denominator!
Annotation key: 'category' value: 'accessing'!

Fraction method!
floor ^numerator // denominator!
Annotation key: 'category' value: 'truncation and rounding'!

Fraction method!
hash ^numerator hash bitXor: denominator hash!
Annotation key: 'category' value: 'comparing'!

Fraction method!
isFraction ^true!
Annotation key: 'category' value: 'testing'!

Fraction method!
negated ^Fraction numerator: numerator negated denominator: denominator!
Annotation key: 'category' value: 'arithmetic'!

Fraction method!
numerator ^numerator!
Annotation key: 'category' value: 'accessing'!

Fraction method!
printOn: aStream aStream nextPutAll: numerator printString; nextPut: $/; nextPutAll: denominator printString!
Annotation key: 'category' value: 'printing'!

Fraction method!
printString ^numerator printString, '/', denominator printString!
Annotation key: 'category' value: 'printing'!

Fraction method!
rounded ^(self + (self sign / 2)) truncated!
Annotation key: 'category' value: 'truncation and rounding'!

Fraction method!
truncated ^numerator quo: denominator!
Annotation key: 'category' value: 'truncation and rounding'!

export const libraryClasses = [
  ['Fraction', 'Number', ['numerator', 'denominator'], 'Kernel-Numbers'],
  ['Association', 'Object', ['key', 'value'], 'Collections-Support'],
  ['OrderedCollection', 'SequenceableCollection', ['items'], 'Collections-Sequenceable'],
  ['SortedCollection', 'OrderedCollection', ['sortBlock'], 'Collections-Sequenceable'],
  ['Interval', 'SequenceableCollection', ['start', 'stop', 'step'], 'Collections-Sequenceable'],
  ['Set', 'Collection', ['tally', 'buckets'], 'Collections-Unordered'],
  ['Bag', 'Collection', ['contents'], 'Collections-Unordered'],
  ['Dictionary', 'Collection', ['tally', 'buckets'], 'Collections-Unordered'],
  ['IdentityDictionary', 'Dictionary', [], 'Collections-Unordered'],
  ['Stream', 'Object', [], 'Collections-Streams'],
  ['ReadStream', 'Stream', ['collection', 'position', 'limit'], 'Collections-Streams'],
  ['WriteStream', 'Stream', ['buffer', 'kind'], 'Collections-Streams'],
];

export const librarySource = {
  Object: {
    printing: [
      `printOn: aStream
        | name |
        name := self class name.
        aStream nextPutAll: ((name at: 1) isVowel ifTrue: ['an '] ifFalse: ['a ']); nextPutAll: name`,
      `printString
        | stream |
        stream := WriteStream on: String new.
        self printOn: stream.
        ^stream contents`,
    ],
    testing: ['isString ^false', 'isSymbol ^false', 'isNumber ^false', 'isInteger ^false', 'isFloat ^false',
      'isFraction ^false', 'isCharacter ^false', 'isArray ^false', 'isCollection ^false'],
    'error handling': [
      `subclassResponsibility ^self error: 'A subclass must implement this message.'`,
      `shouldNotImplement ^self error: 'This message is not appropriate for this object.'`,
    ],
    associating: ['-> anObject ^Association key: self value: anObject'],
  },
  UndefinedObject: { printing: [`printOn: aStream aStream nextPutAll: 'nil'`] },
  True: {
    printing: [`printOn: aStream aStream nextPutAll: 'true'`],
    logical: ['& aBoolean ^aBoolean', '| aBoolean ^true'],
  },
  False: {
    printing: [`printOn: aStream aStream nextPutAll: 'false'`],
    logical: ['& aBoolean ^false', '| aBoolean ^aBoolean'],
  },
  Boolean: { logical: ['eqv: aBoolean ^self == aBoolean', 'xor: aBoolean ^(self == aBoolean) not'] },
  Class: { printing: ['printOn: aStream aStream nextPutAll: self name'] },
  Block: {
    control: ['whileTrue ^[self value] whileTrue: []', 'whileFalse ^[self value] whileFalse: []'],
    accessing: ['numArgs ^self argumentCount'],
  },
  Magnitude: {
    comparing: [
      '< aMagnitude ^self subclassResponsibility',
      '> aMagnitude ^aMagnitude < self',
      '<= aMagnitude ^(aMagnitude < self) not',
      '>= aMagnitude ^(self < aMagnitude) not',
      'between: min and: max ^self >= min and: [self <= max]',
      'max: aMagnitude ^self > aMagnitude ifTrue: [self] ifFalse: [aMagnitude]',
      'min: aMagnitude ^self < aMagnitude ifTrue: [self] ifFalse: [aMagnitude]',
    ],
  },
  Number: {
    printing: ['printOn: aStream aStream nextPutAll: self printString', 'asString ^self printString'],
    testing: [
      'isNumber ^true',
      'negative ^self < (self - self)',
      'positive ^self >= (self - self)',
      'strictlyPositive ^self > (self - self)',
      'isZero ^self = (self - self)',
      'even ^(self \\\\ 2) = 0',
      'odd ^self even not',
    ],
    arithmetic: [
      'abs ^self negative ifTrue: [self negated] ifFalse: [self]',
      'sign ^self strictlyPositive ifTrue: [1] ifFalse: [self negative ifTrue: [-1] ifFalse: [0]]',
      'squared ^self * self',
      'reciprocal ^1 / self',
      '// aNumber ^(self / aNumber) floor',
      '\\\\ aNumber ^self - (self // aNumber * aNumber)',
      'quo: aNumber ^(self / aNumber) truncated',
      'rem: aNumber ^self - ((self quo: aNumber) * aNumber)',
    ],
    'mathematical functions': [
      `raisedTo: aNumber
        aNumber isInteger ifTrue: [^self raisedToInteger: aNumber].
        ^self error: 'raisedTo: with a non-Integer exponent requires Float operands. Convert with asFloat.'`,
      `raisedToInteger: anInteger
        | result base exponent |
        anInteger negative ifTrue: [^(self raisedToInteger: anInteger negated) reciprocal].
        anInteger = 0 ifTrue: [^self isFloat ifTrue: [1.0] ifFalse: [1]].
        base := self. exponent := anInteger.
        [exponent > 0] whileTrue: [
          exponent odd ifTrue: [result := result isNil ifTrue: [base] ifFalse: [result * base]].
          exponent := exponent // 2.
          exponent > 0 ifTrue: [base := base * base]].
        ^result`,
      'sqrt ^self asFloat sqrt',
    ],
    'truncation and rounding': [
      'asInteger ^self rounded',
      'integerPart ^self truncated',
      'fractionPart ^self - self integerPart',
      'roundTo: aNumber ^(self / aNumber) rounded * aNumber',
      'truncateTo: aNumber ^(self quo: aNumber) * aNumber',
    ],
    converting: ['asFloatD ^self asFloat', 'asFloatE ^self asFloat', 'asFloatQ ^self asFloat'],
    intervals: [
      'to: stop ^Interval from: self to: stop',
      'to: stop by: step ^Interval from: self to: stop by: step',
      `to: stop do: aBlock
        | value |
        value := self.
        [value <= stop] whileTrue: [aBlock value: value. value := value + 1]`,
      `to: stop by: step do: aBlock
        | value |
        step isZero ifTrue: [^self error: 'The step must not be zero.'].
        value := self.
        step strictlyPositive
          ifTrue: [[value <= stop] whileTrue: [aBlock value: value. value := value + step]]
          ifFalse: [[value >= stop] whileTrue: [aBlock value: value. value := value + step]]`,
    ],
  },
  Integer: {
    testing: ['isInteger ^true'],
    'truncation and rounding': ['truncated ^self', 'floor ^self', 'ceiling ^self', 'rounded ^self', 'asInteger ^self', 'asFraction ^self'],
    arithmetic: [
      'lcm: anInteger (self = 0 or: [anInteger = 0]) ifTrue: [^0]. ^(self * anInteger) abs // (self gcd: anInteger)',
      `factorial
        | result |
        self negative ifTrue: [^self error: 'factorial requires a nonnegative Integer.'].
        result := 1.
        2 to: self do: [:each | result := result * each].
        ^result`,
    ],
    'bit manipulation': [
      'allMask: mask ^(self bitAnd: mask) = mask',
      'anyMask: mask ^(self bitAnd: mask) ~= 0',
      'noMask: mask ^(self bitAnd: mask) = 0',
      `bitAt: index put: bit
        | mask |
        mask := 1 bitShift: index - 1.
        ^bit = 0 ifTrue: [self bitAnd: -1 - mask] ifFalse: [self bitOr: mask]`,
    ],
    printing: [
      `printOn: aStream base: radix showRadix: flag
        | text |
        text := self printStringRadix: radix.
        flag ifFalse: [
          text := self negative
            ifTrue: ['-', (text copyFrom: (text indexOf: $r) + 1 to: text size)]
            ifFalse: [text copyFrom: (text indexOf: $r) + 1 to: text size]].
        aStream nextPutAll: text`,
    ],
    enumerating: [`timesRepeat: aBlock
      | count |
      count := 1.
      [count <= self] whileTrue: [aBlock value. count := count + 1]`],
  },
  Float: {
    testing: ['isFloat ^true'],
    arithmetic: ['reciprocal ^1.0 / self'],
    'mathematical functions': ['floorLog: radix ^(self ln / radix asFloat ln) floor'],
  },
  Fraction: {
    accessing: ['numerator ^numerator', 'denominator ^denominator'],
    testing: ['isFraction ^true'],
    arithmetic: [
      `+ aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber denominator + (aNumber numerator * denominator)
          denominator: denominator * aNumber denominator`,
      `- aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber denominator - (aNumber numerator * denominator)
          denominator: denominator * aNumber denominator`,
      `* aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber numerator denominator: denominator * aNumber denominator`,
      `/ aNumber
        self checkExact: aNumber.
        ^Fraction numerator: numerator * aNumber denominator denominator: denominator * aNumber numerator`,
      'negated ^Fraction numerator: numerator negated denominator: denominator',
      `checkExact: aNumber
        (aNumber isInteger or: [aNumber isFraction]) ifFalse: [
          self error: 'Fraction arithmetic requires an Integer or Fraction. Convert Floats with asFloat.']`,
    ],
    comparing: [
      '< aNumber self checkExact: aNumber. ^numerator * aNumber denominator < (aNumber numerator * denominator)',
      '= anObject ^(anObject isKindOf: Fraction) and: [numerator = anObject numerator and: [denominator = anObject denominator]]',
      'hash ^numerator hash bitXor: denominator hash',
    ],
    'truncation and rounding': [
      'truncated ^numerator quo: denominator',
      'floor ^numerator // denominator',
      'ceiling ^(numerator + denominator - 1) // denominator',
      'rounded ^(self + (self sign / 2)) truncated',
      'asFraction ^self',
    ],
    converting: ['asFloat ^numerator asFloat / denominator asFloat'],
    printing: [`printOn: aStream aStream nextPutAll: numerator printString; nextPut: $/; nextPutAll: denominator printString`,
      'printString ^numerator printString, \'/\', denominator printString'],
  },
  Character: {
    testing: ['isCharacter ^true'],
    printing: ['printOn: aStream aStream nextPutAll: self printString'],
  },
  Association: {
    accessing: ['key ^key', 'value ^value', 'key: anObject key := anObject', 'value: anObject value := anObject',
      'key: aKey value: aValue key := aKey. value := aValue'],
    comparing: ['= anObject ^(anObject isKindOf: Association) and: [key = anObject key and: [value = anObject value]]',
      'hash ^key hash bitXor: value hash'],
    printing: ['printOn: aStream key printOn: aStream. aStream nextPutAll: \'->\'. value printOn: aStream'],
  },
  'Association class': { 'instance creation': ['key: aKey value: aValue ^self basicNew key: aKey value: aValue'] },
  Collection: {
    testing: [
      'isCollection ^true',
      'isEmpty ^self size = 0',
      'notEmpty ^self isEmpty not',
      'includes: anObject self do: [:each | each = anObject ifTrue: [^true]]. ^false',
      `occurrencesOf: anObject
        | count |
        count := 0.
        self do: [:each | each = anObject ifTrue: [count := count + 1]].
        ^count`,
      'allSatisfy: aBlock self do: [:each | (aBlock value: each) ifFalse: [^false]]. ^true',
      'anySatisfy: aBlock self do: [:each | (aBlock value: each) ifTrue: [^true]]. ^false',
    ],
    accessing: [`size
      | count |
      count := 0.
      self do: [:each | count := count + 1].
      ^count`],
    enumerating: [
      'do: aBlock ^self subclassResponsibility',
      `do: aBlock separatedBy: separatorBlock
        | first |
        first := true.
        self do: [:each | first ifFalse: [separatorBlock value]. first := false. aBlock value: each]`,
      `detect: aBlock ^self detect: aBlock ifNone: [self error: 'No element satisfies the condition.']`,
      'detect: aBlock ifNone: exceptionBlock self do: [:each | (aBlock value: each) ifTrue: [^each]]. ^exceptionBlock value',
      `inject: initialValue into: aBlock
        | value |
        value := initialValue.
        self do: [:each | value := aBlock value: value value: each].
        ^value`,
      `collect: aBlock
        | result |
        result := self species new.
        self do: [:each | result add: (aBlock value: each)].
        ^result`,
      `select: aBlock
        | result |
        result := self species new.
        self do: [:each | (aBlock value: each) ifTrue: [result add: each]].
        ^result`,
      `reject: aBlock ^self select: [:each | (aBlock value: each) not]`,
    ],
    adding: ['addAll: aCollection aCollection do: [:each | self add: each]. ^aCollection'],
    removing: [
      `remove: oldObject ^self remove: oldObject ifAbsent: [self error: 'The object is not in the collection.']`,
      'removeAll: aCollection aCollection do: [:each | self remove: each]. ^aCollection',
    ],
    converting: [
      `asArray
        | stream |
        stream := WriteStream on: Array new.
        self do: [:each | stream nextPut: each].
        ^stream contents`,
      'asOrderedCollection ^OrderedCollection new addAll: self; yourself',
      'asSet ^Set new addAll: self; yourself',
      'asBag ^Bag new addAll: self; yourself',
      'asSortedCollection ^self asSortedCollection: [:a :b | a <= b]',
      'asSortedCollection: aBlock ^(SortedCollection sortBlock: aBlock) addAll: self; yourself',
    ],
    copying: ['species ^self class', 'rehash ^self'],
    printing: [`printOn: aStream
      super printOn: aStream.
      aStream nextPut: $(.
      self do: [:each | each printOn: aStream] separatedBy: [aStream space].
      aStream nextPut: $)`],
  },
  'Collection class': {
    'instance creation': [
      'with: a ^self new add: a; yourself',
      'with: a with: b ^self new add: a; add: b; yourself',
      'with: a with: b with: c ^self new add: a; add: b; add: c; yourself',
      'with: a with: b with: c with: d ^self new add: a; add: b; add: c; add: d; yourself',
      'withAll: aCollection ^self new addAll: aCollection; yourself',
    ],
  },
  SequenceableCollection: {
    accessing: [
      `at: index ifAbsent: exceptionBlock
        ^(index between: 1 and: self size) ifTrue: [self at: index] ifFalse: [exceptionBlock value]`,
      `first ^self isEmpty ifTrue: [self error: 'The collection is empty.'] ifFalse: [self at: 1]`,
      `last ^self isEmpty ifTrue: [self error: 'The collection is empty.'] ifFalse: [self at: self size]`,
      `after: target
        | index |
        index := self indexOf: target.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        index = self size ifTrue: [^self error: 'The object is the last element.'].
        ^self at: index + 1`,
      `before: target
        | index |
        index := self indexOf: target.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        index = 1 ifTrue: [^self error: 'The object is the first element.'].
        ^self at: index - 1`,
      `indexOf: anElement ^self indexOf: anElement ifAbsent: [0]`,
      `indexOf: anElement ifAbsent: exceptionBlock
        1 to: self size do: [:index | (self at: index) = anElement ifTrue: [^index]].
        ^exceptionBlock value`,
      `indexOfSubCollection: aSubCollection startingAt: start
        ^self indexOfSubCollection: aSubCollection startingAt: start ifAbsent: [0]`,
      `indexOfSubCollection: aSubCollection startingAt: start ifAbsent: exceptionBlock
        start to: self size - aSubCollection size + 1 do: [:index |
          | match |
          match := true.
          1 to: aSubCollection size do: [:offset |
            (self at: index + offset - 1) = (aSubCollection at: offset) ifFalse: [match := false]].
          match ifTrue: [^index]].
        ^exceptionBlock value`,
      `findFirst: aBlock
        1 to: self size do: [:index | (aBlock value: (self at: index)) ifTrue: [^index]].
        ^0`,
      `findLast: aBlock
        self size to: 1 by: -1 do: [:index | (aBlock value: (self at: index)) ifTrue: [^index]].
        ^0`,
    ],
    testing: ['includes: anObject ^(self indexOf: anObject) > 0', 'isEmpty ^self size = 0'],
    comparing: [
      `= aCollection
        self class == aCollection class ifFalse: [^false].
        self size = aCollection size ifFalse: [^false].
        1 to: self size do: [:index | (self at: index) = (aCollection at: index) ifFalse: [^false]].
        ^true`,
      `hash
        | value |
        value := self size hash.
        self do: [:each | value := value bitXor: each hash].
        ^value`,
    ],
    enumerating: [
      'do: aBlock 1 to: self size do: [:index | aBlock value: (self at: index)]',
      'reverseDo: aBlock self size to: 1 by: -1 do: [:index | aBlock value: (self at: index)]',
      'keysAndValuesDo: aBlock 1 to: self size do: [:index | aBlock value: index value: (self at: index)]',
      'from: start to: stop do: aBlock start to: stop do: [:index | aBlock value: (self at: index)]',
      'from: start to: stop keysAndValuesDo: aBlock start to: stop do: [:index | aBlock value: index value: (self at: index)]',
      `with: aCollection do: aBlock
        self size = aCollection size ifFalse: [^self error: 'The collections must have the same size.'].
        1 to: self size do: [:index | aBlock value: (self at: index) value: (aCollection at: index)]`,
      `collect: aBlock
        | stream |
        stream := self newWriteStream.
        self do: [:each | stream nextPut: (aBlock value: each)].
        ^stream contents`,
      `select: aBlock
        | stream |
        stream := self newWriteStream.
        self do: [:each | (aBlock value: each) ifTrue: [stream nextPut: each]].
        ^stream contents`,
    ],
    copying: [
      'newWriteStream ^WriteStream on: self species new',
      `, aCollection
        | stream |
        stream := self newWriteStream.
        self do: [:each | stream nextPut: each].
        aCollection do: [:each | stream nextPut: each].
        ^stream contents`,
      `copyFrom: start to: stop
        | stream |
        stream := self newWriteStream.
        start to: stop do: [:index | stream nextPut: (self at: index)].
        ^stream contents`,
      `copyWith: newElement
        | stream |
        stream := self newWriteStream.
        self do: [:each | stream nextPut: each].
        stream nextPut: newElement.
        ^stream contents`,
      'copyWithout: oldElement ^self reject: [:each | each = oldElement]',
      `copyReplaceFrom: start to: stop with: replacement
        | stream |
        stream := self newWriteStream.
        1 to: start - 1 do: [:index | stream nextPut: (self at: index)].
        replacement do: [:each | stream nextPut: each].
        stop + 1 to: self size do: [:index | stream nextPut: (self at: index)].
        ^stream contents`,
      `copyReplaceFrom: start to: stop withObject: replacementElement
        | stream |
        stream := self newWriteStream.
        1 to: self size do: [:index |
          stream nextPut: ((index between: start and: stop) ifTrue: [replacementElement] ifFalse: [self at: index])].
        ^stream contents`,
      `copyReplaceAll: oldSubCollection with: newSubCollection
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
        ^stream contents`,
      'copyReplacing: oldElement withObject: newElement ^self collect: [:each | each = oldElement ifTrue: [newElement] ifFalse: [each]]',
      `reverse
        | stream |
        stream := self newWriteStream.
        self reverseDo: [:each | stream nextPut: each].
        ^stream contents`,
    ],
    replacing: [
      'atAll: indices put: anObject indices do: [:index | self at: index put: anObject]. ^anObject',
      'atAllPut: anObject 1 to: self size do: [:index | self at: index put: anObject]. ^anObject',
      'replaceFrom: start to: stop with: replacement ^self replaceFrom: start to: stop with: replacement startingAt: 1',
      `replaceFrom: start to: stop with: replacement startingAt: repStart
        | source |
        source := repStart.
        start to: stop do: [:index | self at: index put: (replacement at: source). source := source + 1]`,
      'replaceFrom: start to: stop withObject: anObject start to: stop do: [:index | self at: index put: anObject]',
    ],
  },
  'ArrayedCollection class': {
    'instance creation': [
      'new ^self new: 0',
      'with: a ^(self new: 1) at: 1 put: a; yourself',
      'with: a with: b ^(self new: 2) at: 1 put: a; at: 2 put: b; yourself',
      'with: a with: b with: c ^(self new: 3) at: 1 put: a; at: 2 put: b; at: 3 put: c; yourself',
      'with: a with: b with: c with: d ^(self new: 4) at: 1 put: a; at: 2 put: b; at: 3 put: c; at: 4 put: d; yourself',
      `withAll: aCollection
        | result index |
        result := self new: aCollection size.
        index := 0.
        aCollection do: [:each | index := index + 1. result at: index put: each].
        ^result`,
    ],
  },
  Array: {
    testing: ['isArray ^true'],
    printing: [`printOn: aStream
      aStream nextPutAll: '#('.
      self do: [:each | each printOn: aStream] separatedBy: [aStream space].
      aStream nextPut: $)`],
  },
  String: {
    testing: ['isString ^true'],
    copying: ['species ^String'],
    printing: ['printOn: aStream aStream nextPutAll: self printString'],
    converting: [`subStrings ^self subStrings: (String with: Character space with: Character tab with: Character cr with: Character lf)`],
  },
  'String class': {
    'instance creation': [
      'with: a ^self withAll: (Array with: a)',
      'with: a with: b ^self withAll: (Array with: a with: b)',
      'with: a with: b with: c ^self withAll: (Array with: a with: b with: c)',
      'with: a with: b with: c with: d ^self withAll: (Array with: a with: b with: c with: d)',
      `withAll: aCollection
        | stream |
        stream := WriteStream on: String new.
        aCollection do: [:each | stream nextPut: each].
        ^stream contents`,
    ],
  },
  Symbol: { testing: ['isSymbol ^true'] },
  OrderedCollection: {
    adding: [
      'add: anObject ^self addLast: anObject',
      `add: newObject after: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self add: newObject beforeIndex: index + 1`,
      `add: newObject before: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self add: newObject beforeIndex: index`,
      'add: newObject afterIndex: index ^self add: newObject beforeIndex: index + 1',
      `addAll: aCollection beforeIndex: index
        | position |
        position := index.
        aCollection do: [:each | self add: each beforeIndex: position. position := position + 1].
        ^aCollection`,
      'addAll: aCollection afterIndex: index ^self addAll: aCollection beforeIndex: index + 1',
      `addAll: aCollection after: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self addAll: aCollection beforeIndex: index + 1`,
      `addAll: aCollection before: oldObject
        | index |
        index := self indexOf: oldObject.
        index = 0 ifTrue: [^self error: 'The object is not in the collection.'].
        ^self addAll: aCollection beforeIndex: index`,
      'addAllFirst: aCollection ^self addAll: aCollection beforeIndex: 1',
      'addAllLast: aCollection aCollection do: [:each | self addLast: each]. ^aCollection',
    ],
    removing: [`remove: oldObject ifAbsent: exceptionBlock
      | index |
      index := self indexOf: oldObject.
      index = 0 ifTrue: [^exceptionBlock value].
      ^self removeAtIndex: index`],
  },
  'OrderedCollection class': {
    'instance creation': ['new ^self basicNew initialize', 'new: anInteger ^self new'],
  },
  SortedCollection: {
    accessing: ['sortBlock ^sortBlock', 'sortBlock: aBlock sortBlock := aBlock. self resort'],
    adding: [
      `add: anObject
        | low high middle |
        low := 1.
        high := self size.
        [low <= high] whileTrue: [
          middle := (low + high) // 2.
          (sortBlock value: (self at: middle) value: anObject)
            ifTrue: [low := middle + 1]
            ifFalse: [high := middle - 1]].
        super add: anObject beforeIndex: low.
        ^anObject`,
      'addFirst: anObject ^self shouldNotImplement',
      'addLast: anObject ^self shouldNotImplement',
      'add: anObject beforeIndex: index ^self shouldNotImplement',
      'at: index put: anObject ^self shouldNotImplement',
    ],
    private: [
      'setSortBlock: aBlock sortBlock := aBlock',
      `resort
        | elements |
        elements := self asArray.
        self initialize.
        elements do: [:each | self add: each]`,
    ],
    copying: ['species ^OrderedCollection'],
    enumerating: [
      `select: aBlock
        | result |
        result := SortedCollection sortBlock: sortBlock.
        self do: [:each | (aBlock value: each) ifTrue: [result add: each]].
        ^result`,
    ],
    converting: ['asSortedCollection ^(SortedCollection sortBlock: sortBlock) addAll: self; yourself'],
  },
  'SortedCollection class': {
    'instance creation': [
      'sortBlock: aBlock ^self basicNew initialize; setSortBlock: aBlock; yourself',
      'new ^self sortBlock: [:a :b | a <= b]',
      'new: anInteger ^self new',
    ],
  },
  Interval: {
    private: [`setFrom: first to: last by: increment
      (increment = (increment - increment)) ifTrue: [^self error: 'The step must not be zero.'].
      start := first. stop := last. step := increment`],
    accessing: [
      `size
        step strictlyPositive
          ifTrue: [stop < start ifTrue: [^0]. ^(stop - start) // step + 1]
          ifFalse: [start < stop ifTrue: [^0]. ^(start - stop) // step negated + 1]`,
      `at: index
        (index between: 1 and: self size) ifFalse: [^self error: 'Index ', index printString, ' is outside 1 through ', self size printString, '.'].
        ^start + (step isFloat ifTrue: [(index - 1) asFloat * step] ifFalse: [(index - 1) * step])`,
      'first ^self isEmpty ifTrue: [self error: \'The collection is empty.\'] ifFalse: [start]',
    ],
    enumerating: [`do: aBlock
      | value |
      value := start.
      step strictlyPositive
        ifTrue: [[value <= stop] whileTrue: [aBlock value: value. value := value + step]]
        ifFalse: [[value >= stop] whileTrue: [aBlock value: value. value := value + step]]`],
    copying: ['species ^Array'],
    printing: [`printOn: aStream
      aStream nextPut: $(; nextPutAll: start printString; nextPutAll: ' to: '; nextPutAll: stop printString.
      step = 1 ifFalse: [aStream nextPutAll: ' by: '; nextPutAll: step printString].
      aStream nextPut: $)`],
  },
  'Interval class': {
    'instance creation': [
      'from: start to: stop ^self from: start to: stop by: 1',
      'from: start to: stop by: step ^self basicNew setFrom: start to: stop by: step',
    ],
  },
  Set: {
    private: [
      'initialize: capacity buckets := Array new: (capacity max: 8). tally := 0',
      'hashOf: anObject ^anObject hash',
      'is: a sameAs: b ^a = b',
      'indexFor: anObject ^((self hashOf: anObject) \\\\ buckets size) + 1',
      `bucketFor: anObject
        | index bucket |
        index := self indexFor: anObject.
        bucket := buckets at: index.
        bucket isNil ifTrue: [bucket := OrderedCollection new. buckets at: index put: bucket].
        ^bucket`,
      'growIfNeeded tally * 4 > (buckets size * 3) ifTrue: [self rehashTo: buckets size * 2]',
      `rehashTo: capacity
        | old |
        old := buckets.
        buckets := Array new: capacity.
        tally := 0.
        old do: [:bucket | bucket isNil ifFalse: [bucket do: [:each | self add: each]]]`,
    ],
    accessing: ['size ^tally'],
    adding: [`add: newObject
      | bucket |
      bucket := self bucketFor: newObject.
      bucket do: [:each | (self is: each sameAs: newObject) ifTrue: [^newObject]].
      bucket add: newObject.
      tally := tally + 1.
      self growIfNeeded.
      ^newObject`],
    removing: [`remove: oldObject ifAbsent: exceptionBlock
      | bucket |
      bucket := buckets at: (self indexFor: oldObject).
      bucket isNil ifFalse: [
        1 to: bucket size do: [:index |
          (self is: (bucket at: index) sameAs: oldObject) ifTrue: [
            bucket removeAtIndex: index.
            tally := tally - 1.
            ^oldObject]]].
      ^exceptionBlock value`],
    testing: [`includes: anObject
      | bucket |
      bucket := buckets at: (self indexFor: anObject).
      bucket isNil ifTrue: [^false].
      bucket do: [:each | (self is: each sameAs: anObject) ifTrue: [^true]].
      ^false`],
    enumerating: [
      'do: aBlock buckets do: [:bucket | bucket isNil ifFalse: [bucket do: aBlock]]',
      `collect: aBlock
        | result |
        result := Set new.
        self do: [:each | result add: (aBlock value: each)].
        ^result`,
    ],
    copying: ['copy ^self species new addAll: self; yourself', 'rehash self rehashTo: buckets size'],
  },
  'Set class': { 'instance creation': ['new ^self new: 16', 'new: capacity ^self basicNew initialize: capacity'] },
  Bag: {
    private: ['setContents: aDictionary contents := aDictionary'],
    adding: [
      'add: anObject ^self add: anObject withOccurrences: 1',
      `add: anObject withOccurrences: anInteger
        contents at: anObject put: (contents at: anObject ifAbsent: [0]) + anInteger.
        ^anObject`,
    ],
    removing: [`remove: oldObject ifAbsent: exceptionBlock
      | count |
      count := contents at: oldObject ifAbsent: [^exceptionBlock value].
      count = 1 ifTrue: [contents removeKey: oldObject] ifFalse: [contents at: oldObject put: count - 1].
      ^oldObject`],
    testing: ['occurrencesOf: anObject ^contents at: anObject ifAbsent: [0]', 'includes: anObject ^contents includesKey: anObject'],
    accessing: ['size ^contents inject: 0 into: [:sum :count | sum + count]'],
    enumerating: [
      'do: aBlock contents keysAndValuesDo: [:each :count | count timesRepeat: [aBlock value: each]]',
      `collect: aBlock
        | result |
        result := Bag new.
        self do: [:each | result add: (aBlock value: each)].
        ^result`,
    ],
    copying: ['copy ^Bag new addAll: self; yourself', 'rehash contents rehash'],
  },
  'Bag class': { 'instance creation': ['new ^self basicNew setContents: Dictionary new', 'new: capacity ^self new'] },
  Dictionary: {
    private: [
      'initialize: capacity buckets := Array new: (capacity max: 8). tally := 0',
      'hashOf: aKey ^aKey hash',
      'is: a sameAs: b ^a = b',
      'indexFor: aKey ^((self hashOf: aKey) \\\\ buckets size) + 1',
      'growIfNeeded tally * 4 > (buckets size * 3) ifTrue: [self rehashTo: buckets size * 2]',
      `rehashTo: capacity
        | old |
        old := buckets.
        buckets := Array new: capacity.
        tally := 0.
        old do: [:bucket | bucket isNil ifFalse: [bucket do: [:association | self at: association key put: association value]]]`,
      `associationAt: aKey ifAbsent: exceptionBlock
        | bucket |
        bucket := buckets at: (self indexFor: aKey).
        bucket isNil ifTrue: [^exceptionBlock value].
        bucket do: [:association | (self is: association key sameAs: aKey) ifTrue: [^association]].
        ^exceptionBlock value`,
    ],
    accessing: [
      'size ^tally',
      `at: aKey ^self at: aKey ifAbsent: [self error: 'Key not found: ', aKey printString]`,
      'at: aKey ifAbsent: exceptionBlock ^(self associationAt: aKey ifAbsent: [^exceptionBlock value]) value',
      'at: aKey ifAbsentPut: aBlock ^self at: aKey ifAbsent: [self at: aKey put: aBlock value]',
      `at: aKey put: aValue
        | association index bucket |
        association := self associationAt: aKey ifAbsent: [nil].
        association isNil ifFalse: [association value: aValue. ^aValue].
        index := self indexFor: aKey.
        bucket := buckets at: index.
        bucket isNil ifTrue: [bucket := OrderedCollection new. buckets at: index put: bucket].
        bucket add: (Association key: aKey value: aValue).
        tally := tally + 1.
        self growIfNeeded.
        ^aValue`,
      `keys
        | result |
        result := Set new.
        self keysDo: [:each | result add: each].
        ^result`,
      `values
        | stream |
        stream := WriteStream on: Array new.
        self do: [:each | stream nextPut: each].
        ^stream contents`,
      'keyAtValue: aValue ^self keyAtValue: aValue ifAbsent: [nil]',
      'keyAtValue: aValue ifAbsent: exceptionBlock self keysAndValuesDo: [:key :value | value = aValue ifTrue: [^key]]. ^exceptionBlock value',
    ],
    testing: ['includesKey: aKey self associationAt: aKey ifAbsent: [^false]. ^true'],
    removing: [
      `removeKey: aKey ^self removeKey: aKey ifAbsent: [self error: 'Key not found: ', aKey printString]`,
      `removeKey: aKey ifAbsent: exceptionBlock
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
        ^exceptionBlock value`,
      'removeAllKeys: keys keys do: [:each | self removeKey: each]',
      'removeAllKeys: keys ifAbsent: exceptionBlock keys do: [:each | self removeKey: each ifAbsent: exceptionBlock]',
    ],
    adding: ['addAll: aDictionary aDictionary keysAndValuesDo: [:key :value | self at: key put: value]. ^aDictionary'],
    enumerating: [
      'associationsDo: aBlock buckets do: [:bucket | bucket isNil ifFalse: [bucket do: aBlock]]',
      'keysAndValuesDo: aBlock self associationsDo: [:association | aBlock value: association key value: association value]',
      'keysDo: aBlock self associationsDo: [:association | aBlock value: association key]',
      'do: aBlock self associationsDo: [:association | aBlock value: association value]',
      `collect: aBlock
        | result |
        result := self species new.
        self keysAndValuesDo: [:key :value | result at: key put: (aBlock value: value)].
        ^result`,
      `select: aBlock
        | result |
        result := self species new.
        self keysAndValuesDo: [:key :value | (aBlock value: value) ifTrue: [result at: key put: value]].
        ^result`,
    ],
    copying: ['copy ^self species new addAll: self; yourself', 'rehash self rehashTo: buckets size'],
    printing: [`printOn: aStream
      | first |
      aStream nextPutAll: self class name; nextPut: $(.
      first := true.
      self associationsDo: [:association | first ifFalse: [aStream space]. first := false. association printOn: aStream].
      aStream nextPut: $)`],
  },
  'Dictionary class': {
    'instance creation': ['new ^self new: 16', 'new: capacity ^self basicNew initialize: capacity',
      'withAll: aDictionary ^self new addAll: aDictionary; yourself'],
  },
  IdentityDictionary: { private: ['hashOf: aKey ^aKey identityHash', 'is: a sameAs: b ^a == b'] },
  Stream: {},
  ReadStream: {
    private: ['setCollection: aCollection collection := aCollection. position := 0. limit := aCollection size'],
    accessing: [
      `next
        self atEnd ifTrue: [^self error: 'The stream is at its end.'].
        position := position + 1.
        ^collection at: position`,
      `next: anInteger
        | stream |
        stream := WriteStream on: collection species new.
        anInteger timesRepeat: [stream nextPut: self next].
        ^stream contents`,
      'peek ^self atEnd ifTrue: [nil] ifFalse: [collection at: position + 1]',
      'peekFor: anObject (self atEnd not and: [self peek = anObject]) ifTrue: [position := position + 1. ^true]. ^false',
      'nextMatchFor: anObject ^self next = anObject',
      `upTo: anObject
        | stream |
        stream := WriteStream on: collection species new.
        [self atEnd] whileFalse: [
          | element |
          element := self next.
          element = anObject ifTrue: [^stream contents].
          stream nextPut: element].
        ^stream contents`,
      `upToEnd
        | stream |
        stream := WriteStream on: collection species new.
        [self atEnd] whileFalse: [stream nextPut: self next].
        ^stream contents`,
      `nextLine
        | line |
        line := self upTo: Character lf.
        ^(line notEmpty and: [line last = Character cr]) ifTrue: [line copyFrom: 1 to: line size - 1] ifFalse: [line]`,
      'contents ^collection copyFrom: 1 to: limit',
    ],
    positioning: [
      'skip: anInteger position := ((position + anInteger) max: 0) min: limit',
      'skipTo: anObject [self atEnd] whileFalse: [self next = anObject ifTrue: [^true]]. ^false',
      'position ^position',
      `position: anInteger
        (anInteger between: 0 and: limit) ifFalse: [^self error: 'The position is outside the stream.'].
        position := anInteger`,
      'reset position := 0',
      'setToEnd position := limit',
    ],
    testing: ['atEnd ^position >= limit', 'isEmpty ^limit = 0'],
    enumerating: ['do: aBlock [self atEnd] whileFalse: [aBlock value: self next]'],
    closing: ['close ^self'],
  },
  'ReadStream class': { 'instance creation': ['on: aCollection ^self basicNew setCollection: aCollection'] },
  WriteStream: {
    accessing: [
      'cr self nextPut: Character lf',
      'space self nextPut: Character space',
      'tab self nextPut: Character tab',
      'print: anObject anObject printOn: self',
      'flush ^self',
      'close ^self',
      'isEmpty ^self contents isEmpty',
      'position ^self contents size',
      'setToEnd ^self',
    ],
  },
  'WriteStream class': {
    'instance creation': ['on: aCollection ^self basicNew initializeOn: aCollection',
      'with: aCollection ^self basicNew initializeWith: aCollection'],
  },
};

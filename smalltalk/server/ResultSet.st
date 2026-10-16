Smalltalk interchangeVersion: '1.0'!
Class named: 'ResultSet'
  superclass: 'Object'
  indexedInstanceVariables: #none
  instanceVariableNames: 'columns rows position rowCount rowsAffected closed'
  classVariableNames: ''
  sharedPools: ''
  classInstanceVariableNames: ''!
Annotation key: 'category' value: 'Server-Data'!

ResultSet method!
atEnd ^position >= rowCount!
Annotation key: 'category' value: 'results'!

ResultSet method!
close rows := nil. closed := true!
Annotation key: 'category' value: 'results'!

ResultSet method!
columns ^columns!
Annotation key: 'category' value: 'results'!

ResultSet method!
initialize: data
      columns := data get: 'columns'. rows := data get: 'rows'.
      rowsAffected := data get: 'rowsAffected'.
      rowCount := (rows get: 'length') truncated. position := 0. closed := false!
Annotation key: 'category' value: 'results'!

ResultSet method!
next: count
      | end page |
      closed ifTrue: [^self fail: 'The result is closed.'].
      self checkCount: count.
      end := position + count.
      end > rowCount ifTrue: [end := rowCount].
      page := rows call: 'slice' with: position asFloat with: end asFloat.
      position := end. ^page!
Annotation key: 'category' value: 'results'!

ResultSet method!
pageFrom: offset count: count
      closed ifTrue: [^self fail: 'The result is closed.'].
      self checkOffset: offset.
      position := offset. ^self next: count!
Annotation key: 'category' value: 'results'!

ResultSet method!
rowCount ^rowCount!
Annotation key: 'category' value: 'results'!

ResultSet method!
rowsAffected ^rowsAffected!
Annotation key: 'category' value: 'results'!

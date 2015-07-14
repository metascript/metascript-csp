#metaimport
  masakari
  hash-require
  '../meta/rpc'

#require
  chai expect
  '../lib/csp'

#external (describe, it)

describe
  '#rpc'
  #->
    it
      'holds the cure to callback hell'
      done ->
        fun f k ->
          #external set-immediate #->
            k (1, 2, 3)

        csp.go #->
          var r = #rpc f ()
          (expect r).to.eql ([1, 2, 3])
          done ()

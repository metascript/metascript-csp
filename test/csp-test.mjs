#metaimport
  masakari
  hash-require

#require
  chai expect
  mori
  '../lib/csp' (go, chan, put, put-async, alts, close!, onto, into, timeout)

#external
  describe
  it

#defmacro #go
  unary
  LOW
  expand: block ->
    `go #->
       try do
         ~`block
       catch var go-error
         done go-error

describe
  'go'
  #->
    describe
      'returns a channel which'
      #->
        it
          'will emit result and close'
          done ->
            const ch = chan ()
            const g  =
              go #->
                var v = yield ch
                v
            #go
              yield put (ch, 42)
              (expect yield g).to.eql 42
              (expect yield g).to.eql null
              done ()

        it
          'will close in case of an exception'
          done ->
            const g =
              go #->
                yield timeout 1
                throw new Error ()
            #go
              (expect yield g).to.eql null
              done ()

describe
  '#chan n'
  #->
    [0, 1, 2, 3].for-each n ->
      it
        'allows #n operations to succeed (' + n + ')'
        done ->
          const ch = chan n
          #go
            var i = 0
            while i < n
              #let ({value} = yield alts ([[ch, i]], {default: ::failed}))
                (expect value).to.eql i
              i += 1
            #let ({value} = yield alts ([[ch, 42]], {default: ::failed}))
              (expect value).to.eql ::failed
            done ()

describe
  '#dropping-chan'
  #->
    [1, 2, 3].for-each n ->
      it
        'preserves first #n elements (' + n + ')'
        done ->
          const
            coll = [1, 2, 3, 4]
            ch   = csp.dropping-chan n
            es   = coll.slice (0, n)
          #go
            yield onto (ch, coll)
            (expect yield into ([], ch)).to.eql es
            (expect yield ch).to.eql null
            done ()

describe
  '#sliding-chan'
  #->
    [1, 2, 3].for-each n ->
      it
        'preserves last #n elements (' + n + ')'
        done ->
          const
            coll = [1, 2, 3, 4]
            ch   = csp.sliding-chan n
            es   = coll.slice (coll.length - n)
          #go
            yield onto (ch, coll)
            (expect yield into ([], ch)).to.eql es
            (expect yield ch).to.eql null
            done ()

describe
  '#close!'
  #->
    it
      'allows pending puts to complete'
      done ->
        const ch =
          #doto (chan ())
            put-async 42
            close!
        #go
          (expect yield ch).to.eql 42
          (expect yield ch).to.eql null
          done ()

    it
      'causes pending takes to complete with null'
      done ->
        const ch1 = chan ()
        const ch2 = chan ()
        #go
          (expect yield ch1).to.eql null
          yield put (ch2, 42)
        #go
          close! ch1
          (expect yield ch2).to.eql 42
          done ()

    const closed-chan =
      #doto (chan ())
        close!

    it
      'causes #put to complete immediatelly with false'
      done ->
        #go
          (expect yield put (closed-chan, 42)).to.eql false
          done ()

    it
      'causes #take to complete immediatelly with null'
      done ->
        #go
          (expect yield closed-chan).to.eql null
          done ()

describe
  '#timeout returns channel which'
  #->
    it
      'closes after the given timeout'
      done ->
        #go
          (expect yield timeout 1).to.eql null
          done ()

    it
      'can be passed to #alts'
      done ->
        const
          c = chan ()
          t = timeout 1
        #go
          #let ({channel} = yield alts ([c, t]))
            (expect channel).to.equal t
          done ()

    it
      'can be explicitly taken from'
      done ->
        const c = timeout 1
        #go
          (expect yield csp.take c).to.eql null
          done ()

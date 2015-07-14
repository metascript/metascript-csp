#metaimport
  masakari

#metamodule

  #keepmacro #rpc
    unary
    LOW
    expand: call -> do
      fun gensym () ->
        ast.new-tag ('_' + Math.random ().to-string (36).substr (2, 9))

      fun declaration tag ->
        #doto (ast.new-tag tag.get-tag ())
          .handle-as-tag-declaration ()

      var args = call.at 1
      var callback = gensym ()
      args.as-tuple ().push callback

      #doto `do
               var \chan = csp.chan ()
               var (~`declaration callback) =
                 #-> csp.put-async (\chan, Array.prototype.slice.call #external arguments)
               ~`call
               var \result = yield \chan
               \result
        .resolve-virtual ()

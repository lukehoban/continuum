var traversal = (function(exports){
  var objects   = require('./objects'),
      functions = require('./functions'),
      utility   = require('./utility'),
      iteration = require('./iteration'),
      Queue     = require('./Queue'),
      Stack     = require('./Stack');

  var isObject       = objects.isObject,
      hasOwn         = objects.hasOwn,
      create         = objects.create,
      define         = objects.define,
      ownKeys        = objects.keys,
      ownProperties  = objects.properties,
      getPrototypeOf = objects.getPrototypeOf,
      Hash           = objects.Hash,
      each           = iteration.each,
      iterate        = iteration.iterate,
      Item           = iteration.Item,
      StopIteration  = iteration.StopIteration,
      uid            = utility.uid,
      toArray        = functions.toArray,
      fname          = functions.fname;



  function clone(o, hidden){
    function recurse(from, to, key){
      try {
        var val = from[key];
        if (!isObject(val)) {
          return to[key] = val;
        }
        if (from[key] === val) {
          if (hasOwn(from[key], tag)) {
            return to[key] = from[key][tag];
          }
          to[key] = enqueue(from[key]);
        }
      } catch (e) {}
    }

    function enqueue(o){
      var out = o instanceof Array ? [] : create(getPrototypeOf(o));
      tagged.push(o);
      each(list(o), function(item){
        queue.push([o, out, item]);
      });
      o[tag] = out;
      return out;
    }

    var queue = new Queue,
        tag = uid(),
        tagged = [],
        list = hidden ? ownProperties : ownKeys,
        out = enqueue(o);

    while (queue.length) {
      recurse.apply(this, queue.shift());
    }

    each(tagged, function(item){
      delete item[tag];
    });

    return out;
  }
  exports.clone = clone;

  function walk(root, callback){
    var queue = new Queue([[root]]),
        branded = [],
        tag = uid();

    while (queue.length) {
      recurse(queue.shift());
    }

    each(branded, function(item){
      delete item[tag];
    });

    function recurse(node){
      each(node, function(item, key){
        if (isObject(item) && !hasOwn(item, tag)) {
          item[tag] = true;
          branded.push(item);
          var result = callback(item, node);
          if (result === walk.RECURSE) {
            queue.push(item);
          } else if (result === walk.BREAK) {
            queue.empty();
            throw StopIteration;
          }
        }
      });
    }
  }
  exports.walk = walk;

  var BREAK    = walk.BREAK    = 0,
      CONTINUE = walk.CONTINUE = 1,
      RECURSE  = walk.RECURSE  = 2;

  exports.collector = (function(){
    function path(){
      var parts = toArray(arguments);

      for (var i=0; i < parts.length; i++) {

        if (typeof parts[i] === 'function') {
          return function(o){
            for (var i=0; i < parts.length; i++) {
              var part = parts[i],
                  type = typeof part;

              if (type === 'string') {
                o = o[part];
              } else if (type === 'function') {
                o = part(o);
              }
            }
            return o;
          };
        }
      }

      return function(o){
        for (var i=0; i < parts.length; i++) {
          o = o[parts[i]];
        }
        return o;
      };
    }


    function collector(o){
      var handlers = new Hash;
      for (var k in o) {
        if (o[k] instanceof Array) {
          handlers[k] = path(o[k]);
        } else if (typeof o[k] === 'function') {
          handlers[k] = o[k];
        } else {
          handlers[k] = o[k];
        }
      }

      return function(node){
        var items  = [];

        function walker(node, parent){
          if (!node) return CONTINUE;

          if (node instanceof Array) {
            return RECURSE;
          }

          var handler = handlers[node.type];

          if (handler === true) {
            items.push(node);
          } else if (handler === RECURSE || handler === CONTINUE) {
            return handler;
          } else if (typeof handler === 'string') {
            if (node[handler]) {
              walk(node[handler], walker);
            }
          } else if (typeof handler === 'function') {
            var item = handler(node);
            if (item !== undefined) {
              items.push(item);
            }
          }
          return CONTINUE;
        }

        walk(node, walker);

        return items;
      };
    }

    return collector;
  })();


  function walk(root, callback){
    var queue = new Queue([[root]]),
        branded = [],
        tag = uid();

    try {
      while (queue.length) {
        recurse(queue.shift());
      }
    } catch (e) {
      if (e !== StopIteration) throw e;
    }

    each(branded, function(item){
      delete item[tag];
    });

    function recurse(node){
      each(node, function(item, key){
        if (isObject(item) && !hasOwn(item, tag)) {
          item[tag] = true;
          branded.push(item);
          var result = callback(item, node);
          if (result === walk.RECURSE) {
            queue.push(item);
          } else if (result === walk.BREAK) {
            queue.empty();
            throw StopIteration;
          }
        }
      });
    }
  }

  var Visitor = exports.Visitor = (function(){
    function VisitorHandlers(handlers){
      var self = this;
      if (handlers instanceof Array) {
        each(handlers, function(handler){
          self[fname(handler)] = handler;
        });
      } else if (isObject(handlers)) {
        each(handlers, function(handler, name){
          self[name] = handler;
        });
      }
    }

    VisitorHandlers.prototype = create(null);

    function VisitorState(handlers, root){
      var stack = this.stack = new Stack([[root]]);
      this.handlers = handlers;
      this.branded = [];
      this.tag = uid();
      this.context = {
        push: function push(node){
          stack.push(node);
        }
      };
    }

    define(VisitorState.prototype, [
      function cleanup(){
        each(this.branded, function(item){
          delete item[this.tag];
        }, this);
        this.branded = [];
        this.tag = uid();
      },
      function next(node){
        if (node instanceof Item) {
          node = node[1];
        }
        if (isObject(node) && !hasOwn(node, this.tag)) {
          define(node, this.tag, true);
          this.branded.push(node);

          if (node instanceof Array) {
            each(node.slice().reverse(), this.context.push);
          } else if (node.type) {
            if (node.type in this.handlers) {
              var result = this.handlers[node.type].call(this.context, node);
            } else if (this.handlers.__noSuchHandler__) {
              var result = this.handlers.__noSuchHandler__.call(this.context, node);
            }

            if (result == BREAK) {
              throw StopIteration;
            } else if (result === RECURSE) {
              var temp = [];
              iterate(node, temp.push, temp);
              each(temp.reverse(), this.context.push);
            }
          }
        }
      }
    ]);


    function Visitor(handlers){
      if (handlers instanceof VisitorHandlers) {
        this.handlers = handlers;
      } else {
        this.handlers = new VisitorHandlers(handlers);
      }
    }


    define(Visitor.prototype, [
      function visit(root){
        if (root instanceof VisitorState) {
          var visitor = root;
        } else {
          var visitor = new VisitorState(this.handlers, root);
        }

        try {
          while (visitor.stack.length) {
            visitor.next(visitor.stack.pop());
          }
          visitor.cleanup();
        } catch (e) {
          if (e !== StopIteration) throw e;
          var self = this;
          var _resume = function(){
            _resume = function(){};
            return self.visit(visitor);
          }
          return function resume(){ return _resume() };
        }
      }
    ]);


    return Visitor;
  })();


  function createVisitor(handlers){
    return new Visitor(handlers);
  }
  exports.createVisitor = createVisitor;


  function visit(node, handlers){
    return new Visitor(handlers).visit(node);
  }
  exports.visit = visit;


  return exports;
})(typeof module !== 'undefined' ? module.exports : {});


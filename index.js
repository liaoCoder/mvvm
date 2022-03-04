/**
 * vue双向绑定的原理？
 * 比如模版语法有v-model="userName"
 * vue通过defineProperty给userName添加get和set，并且data上每个属性都会new一个对应的Dep用来收集依赖
 * 在编译时，调用CompileUtil.model方法，并实例化了一个watcher
 * 实例化构造函数的时候会调用实例的get方法，这时候将当前的实例赋值给Dep.target上
 * 然后调用CompileUtil.getValue，相当于获取了vm.data.userName
 * 因为userName通过defineProperty做过绑定，所以会触发defineProperty的get方法
 * 然后在get方法中判断Dep.target是否有值，有值的话就调用dep的addSub将Dep.target（watcher）追加到dep的subs中
 * 然后再将Dep.target设为nul，因为不取消的话任何值取值都会追加到dep的subs中
 * 当数据发生改变，会触发set方法来调用Dep的notify将数据更新
 */

/**
 * 观察者（发布订阅）
 * Dep用来存放Watcher，当数据更新就会触发Dep的notify，然后执行所有的watcher的update
 */
class Dep {
  constructor() {
    this.subs = [];
  }
  addSub(watcher) {
    this.subs.push(watcher);
  }
  notify() {
    this.subs.forEach((watcher) => watcher.update());
  }
}
class Watcher {
  constructor(vm, expr, cb) {
    this.vm = vm;
    this.expr = expr;
    this.cb = cb;
    //默认存放一个老值
    this.oldValue = this.get();
  }
  get() {
    Dep.target = this;
    let newValue = CompileUtil.getValue(this.vm, this.expr);
    Dep.target = null;
    return newValue;
  }
  update() {
    //更新的时候再去获取一个新值，再比如新老值，如果新老值不相同就执行回调，并将新值传入
    let newValue = CompileUtil.getValue(this.vm, this.expr);
    if (newValue !== this.oldValue) {
      this.cb(newValue);
    }
  }
}
// vm.$watch(vm, expr, (newVal) => {});

/**
 * 添加defineProperty
 * 作用：通过递归给option中的data绑定defineProperty
 */
class Observer {
  constructor(data) {
    this.observer(data);
  }
  observer(data) {
    if (data && typeof data === "object") {
      for (let key in data) {
        this.defineReactive(data, key, data[key]);
        this.observer(data[key]);
      }
    }
  }
  defineReactive(obj, key, value) {
    let dep = new Dep();
    Object.defineProperty(obj, key, {
      get() {
        if (Dep.target) {
          dep.addSub(Dep.target);
        }
        return value;
      },
      set: (newValue) => {
        if (newValue !== value) {
          value = newValue;
          this.observer(newValue);
          dep.notify();
        }
      },
    });
  }
}

/**
 * 编译类
 * 作用：主要是用于将模版语法转换成数据传入的data
 * @param node 当前节点
 * @param expr 表达式
 * @param vm vue的实例
 */
//编译的工具类
const CompileUtil = {
  getValue(vm, expr) {
    return expr.split(".").reduce((acc, current) => {
      return acc[current];
    }, vm.$data);
  },
  setValue(vm, expr, value) {
    const exprList = expr.split(".");
    exprList.reduce((acc, item, index) => {
      if (exprList.length - 1 === index) {
        return (acc[item] = value);
      }
      return acc[item];
    }, vm.$data);
  },
  getContentValue(vm, expr) {
    //遍历表达式，将内容重新替换成一个完整的内容返回
    return expr.replace(/\{\{(.+?)\}\}/g, (...args) => {
      return this.getValue(vm, args[1]);
    });
  },
  on(node, expr, vm, eventName) {
    node.addEventListener(eventName, (e) => {
      vm[expr].call(vm, e);
    });
  },
  text(node, expr, vm) {
    const fn = this.updater["textUpdater"];
    const content = expr.replace(/\{\{(.+?)\}\}/g, (...args) => {
      //给每个{{}}绑定观察者
      new Watcher(vm, args[1], () => {
        //如果一个expr存在多个{{}}的时候，需要同时获取属性一起替换
        fn(node, this.getContentValue(vm, expr));
      });
      return this.getValue(vm, args[1]);
    });
    fn(node, content);
  },
  html(node, expr, vm) {
    const fn = this.updater["htmlUpdater"];
    new Watcher(vm, expr, (newVal) => {
      fn(node, newVal);
    });
    const newValue = this.getValue(vm, expr);
    fn(node, newValue);
  },
  model(node, expr, vm) {
    const fn = this.updater["modelUpdater"];
    node.addEventListener("input", (e) => {
      const value = e.target.value;
      this.setValue(vm, expr, value);
    });
    //给v-model添加观察者，后续绑定的数据发生改变的话会触发callback重新赋值
    new Watcher(vm, expr, (newVal) => {
      fn(node, newVal);
    });
    const val = this.getValue(vm, expr);
    fn(node, val);
  },
  updater: {
    modelUpdater(node, value) {
      node.value = value;
    },
    htmlUpdater(node, value) {
      node.innerHTML = value;
    },
    textUpdater(node, value) {
      node.textContent = value;
    },
  },
};
class Complier {
  constructor(el, vm) {
    this.vm = vm;
    this.el = this.isElement(el) ? el : document.querySelector(el);
    //将dom的内容转换成文档碎片
    const fragment = this.nodeToFragment(this.el);

    //把节点中的内容进行替换

    //编译模版，用将{{}}和指令中替换成vue传入的data中的数据
    this.compile(fragment);

    //将编译内容放到页面中
    this.el.appendChild(fragment);
  }
  isElement(node) {
    return node.nodeType === 1;
  }
  nodeToFragment(el) {
    let fragment = document.createDocumentFragment();
    let firstChild = null;
    while ((firstChild = el.firstChild)) {
      //如果使用appendChid方法将原dom树中的节点添加到DocumentFragment中时，会删除原来的节点。
      fragment.appendChild(el.firstChild);
    }
    return fragment;
  }
  isDireactive(name) {
    return name.startsWith("v-");
  }
  //编译元素节点
  compileElementNode(node) {
    [...node.attributes].forEach((attr) => {
      const { name, value: expr } = attr;
      //如果节点的属性值是v-开头的话表示是指令
      if (this.isDireactive(name)) {
        const [, directive] = name.split("-");
        //如果是事件绑定的话需要再次split
        const [directiveName, eventName] = directive.split(":");
        //调用不同的指令来处理
        CompileUtil[directiveName](node, expr, this.vm, eventName);
      }
    });
  }
  //编译文本节点
  compileTextNode(node) {
    const content = node.textContent;
    if (/\{\{(.+?)\}\}/.test(content)) {
      CompileUtil["text"](node, content, this.vm);
    }
  }
  compile(fragment) {
    const nodes = fragment.childNodes;
    [...nodes].forEach((child) => {
      if (this.isElement(child)) {
        this.compileElementNode(child);
        //如果是元素节点的话需要再次执行compile
        this.compile(child);
      } else {
        this.compileTextNode(child);
      }
    });
  }
}

/**
 * 设置代理
 */
class ProxyVM {
  constructor(vm, data) {
    if (data && typeof data === "object") {
      for (let key in data) {
        Object.defineProperty(vm, key, {
          get() {
            return data[key];
          },
          set(newVal) {
            data[key] = newVal;
          },
        });
      }
    }
  }
}

//绑定computed
class BindComputeds {
  constructor(vm, computeds) {
    if (computeds && typeof computeds === "object") {
      for (let key in computeds) {
        Object.defineProperty(vm.$data, key, {
          get() {
            return computeds[key].call(vm);
          },
        });
      }
    }
  }
}

//绑定method
class BindMethods {
  constructor(vm, methods) {
    for (const key in methods) {
      Object.defineProperty(vm, key, {
        get() {
          return methods[key].bind(vm);
        },
      });
    }
  }
}

//基类
class MVVM {
  constructor(options) {
    this.$data = options.data;
    this.$el = options.el;
    let computeds = options.computed;
    let methods = options.methods;

    new Observer(this.$data);

    new BindComputeds(this, computeds);

    new BindMethods(this, methods);

    //让每次通过vm.$data获取值的时候都可以直接通过vm获取
    new ProxyVM(this, this.$data);

    new Complier(this.$el, this);
  }
}

/*!
* CanJS - 1.1.6-pre (2013-04-30)
* http://canjs.us/
* Copyright (c) 2013 Bitovi
* Licensed MIT
*/
define(['can/util/library', 'can/util/bind'], function(can, bind) {

    // returns the
    // - observes and attr methods are called by func
    // - the value returned by func
    // ex: `{value: 100, observed: [{obs: o, attr: "completed"}]}`
    var getValueAndObserved = function(func, self) {

        var oldReading;
        if (can.Observe) {
            // Set a callback on can.Observe to know
            // when an attr is read.
            // Keep a reference to the old reader
            // if there is one.  This is used
            // for nested live binding.
            oldReading = can.Observe.__reading;
            can.Observe.__reading = function(obj, attr) {
                // Add the observe and attr that was read
                // to `observed`
                observed.push({
                    obj: obj,
                    attr: attr + ""
                });
            };
        }

        var observed = [],
            // Call the "wrapping" function to get the value. `observed`
            // will have the observe/attribute pairs that were read.
            value = func.call(self);

        // Set back so we are no longer reading.
        if (can.Observe) {
            can.Observe.__reading = oldReading;
        }
        return {
            value: value,
            observed: observed
        };
    },
        // Calls `callback(newVal, oldVal)` everytime an observed property
        // called within `getterSetter` is changed and creates a new result of `getterSetter`.
        // Also returns an object that can teardown all event handlers.
        computeBinder = function(getterSetter, context, callback, computeState) {
            // track what we are observing
            var observing = {},
                // a flag indicating if this observe/attr pair is already bound
                matched = true,
                // the data to return 
                data = {
                    // we will maintain the value while live-binding is taking place
                    value: undefined,
                    // a teardown method that stops listening
                    teardown: function() {
                        for (var name in observing) {
                            var ob = observing[name];
                            ob.observe.obj.unbind(ob.observe.attr, onchanged);
                            delete observing[name];
                        }
                    }
                },
                batchNum;

            // when a property value is changed
            var onchanged = function(ev) {
                // If the compute is no longer bound (because the same change event led to an unbind)
                // then do not call getValueAndBind, or we will leak bindings.
                if (computeState && !computeState.bound) {
                    return;
                }
                if (ev.batchNum === undefined || ev.batchNum !== batchNum) {
                    // store the old value
                    var oldValue = data.value,
                        // get the new value
                        newvalue = getValueAndBind();
                    // update the value reference (in case someone reads)
                    data.value = newvalue;
                    // if a change happened
                    if (newvalue !== oldValue) {
                        callback(newvalue, oldValue);
                    }
                    batchNum = batchNum = ev.batchNum;
                }


            };

            // gets the value returned by `getterSetter` and also binds to any attributes
            // read by the call
            var getValueAndBind = function() {
                var info = getValueAndObserved(getterSetter, context),
                    newObserveSet = info.observed;

                var value = info.value;
                matched = !matched;

                // go through every attribute read by this observe
                can.each(newObserveSet, function(ob) {
                    // if the observe/attribute pair is being observed
                    if (observing[ob.obj._cid + "|" + ob.attr]) {
                        // mark at as observed
                        observing[ob.obj._cid + "|" + ob.attr].matched = matched;
                    } else {
                        // otherwise, set the observe/attribute on oldObserved, marking it as being observed
                        observing[ob.obj._cid + "|" + ob.attr] = {
                            matched: matched,
                            observe: ob
                        };
                        ob.obj.bind(ob.attr, onchanged);
                    }
                });

                // Iterate through oldObserved, looking for observe/attributes
                // that are no longer being bound and unbind them
                for (var name in observing) {
                    var ob = observing[name];
                    if (ob.matched !== matched) {
                        ob.observe.obj.unbind(ob.observe.attr, onchanged);
                        delete observing[name];
                    }
                }
                return value;
            };
            // set the initial value
            data.value = getValueAndBind();
            data.isListening = !can.isEmptyObject(observing);
            return data;
        }

        // if no one is listening ... we can not calculate every time

    can.compute = function(getterSetter, context, eventName) {
        if (getterSetter && getterSetter.isComputed) {
            return getterSetter;
        }
        // stores the result of computeBinder
        var computedData,
            // how many listeners to this this compute
            bindings = 0,
            // the computed object
            computed,
            // an object that keeps track if the computed is bound
            // onchanged needs to know this. It's possible a change happens and results in
            // something that unbinds the compute, it needs to not to try to recalculate who it
            // is listening to
            computeState = {
                bound: false
            },
            // The following functions are overwritten depending on how compute() is called
            // a method to setup listening
            on = function() {},
            // a method to teardown listening
            off = function() {},
            // the current cached value (only valid if bound = true)
            value,
            // how to read the value
            get = function() {
                return value
            },
            // sets the value
            set = function(newVal) {
                value = newVal;
            },
            canReadForChangeEvent = true;

        computed = function(newVal) {
            // setting ...
            if (arguments.length) {
                var old = value;

                // setter may return a value if 
                // setter is for a value maintained exclusively by this compute
                var setVal = set.call(context, newVal, old);

                if (setVal === undefined) {
                    // it's possible, like with the DOM, setting does not
                    // fire a change event, so we must read
                    value = get.call(context);
                } else {
                    value = setVal;
                }

                if (old !== value) {
                    can.Observe.triggerBatch(computed, "change", [value, old]);
                }
                return value;
            } else {
                // Let others konw to listen to changes in this compute
                if (can.Observe.__reading && canReadForChangeEvent) {
                    can.Observe.__reading(computed, 'change');
                }
                // if we are bound, use the cached value
                if (computeState.bound) {
                    return value;
                } else {
                    return get.call(context);
                }
            }
        }

        if (typeof getterSetter === "function") {
            set = getterSetter;
            get = getterSetter;
            canReadForChangeEvent = eventName === false ? false : true;
            computed.hasDependencies = false;
            on = function(update) {
                computedData = computeBinder(getterSetter, context || this, update, computeState);
                computed.hasDependencies = computedData.isListening
                value = computedData.value;
            }
            off = function() {
                computedData.teardown();
            }
        } else if (context) {

            if (typeof context == "string") {
                // `can.compute(obj, "propertyName", [eventName])`
                var propertyName = context;
                get = function() {
                    if (getterSetter instanceof can.Observe) {
                        return getterSetter.attr(propertyName)
                    } else {
                        return getterSetter[propertyName]
                    }
                }
                set = function(newValue) {
                    if (getterSetter instanceof can.Observe) {
                        getterSetter.attr(propertyName, newValue)
                    } else {
                        getterSetter[propertyName] = newValue;
                    }
                }
                var handler;
                on = function(update) {
                    handler = function() {
                        update(get(), value)
                    };
                    can.bind.call(getterSetter, eventName || propertyName, handler)
                }
                off = function() {
                    can.unbind.call(getterSetter, eventName || propertyName, handler)
                }
                value = get();

            } else {
                // `can.compute(initialValue,{get:, set:, on:, off:})`
                value = getterSetter;
                var options = context;
                get = options.get || get;
                set = options.set || set;
                on = options.on || on;
                off = options.off || off;
            }



        } else {
            // `can.compute(5)`
            value = getterSetter;
        }

        computed.isComputed = true;

        can.cid(computed, "compute")
        var updater = function(newValue, oldValue) {
            value = newValue;
            // might need a way to look up new and oldVal
            can.Observe.triggerBatch(computed, "change", [newValue, oldValue])
        }

        return can.extend(computed, {
            _bindsetup: function() {
                if (bindings === 0) {
                    computeState.bound = true;
                    // setup live-binding
                    on.call(this, updater)
                }
                bindings++;
            },
            _bindteardown: function() {
                bindings--;
                if (bindings === 0) {
                    off.call(this, updater)
                    computeState.bound = false;
                }
            },

            bind: can.bindAndSetup,

            unbind: can.unbindAndTeardown
        });
    };
    can.compute.binder = computeBinder;
    return can.compute;
});
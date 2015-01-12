(function ($) {

  window.WisemblyIntercom = {

    version: '0.1.1',

    options: {
      identifier: null,
      script: 'https://widget.intercom.io/widget/',
      scriptTimeout: 5000,
      trackTimeout: 5000,
      trackDelay: 1000,
      isEnabled: true,
      bootData: {},
      onBoot: null,
      onStore: null,
      onFlush: null,
      onTrack: null,
      onTrackError: null,
      onScript: null,
      onScriptError: null
    },

    setOptions: function (options) {
      options = options || {};
      this.options = $.extend(this.options, options);
    },

    init: function () {
      var self = this;

      if (!this.boot()) {
        this._loadScript().done(function () { self.boot(); })
      }
    },

    _get: function (property) {
      if (typeof this.options[property] === 'function')
        return this.options[property].call(this);
      return this.options[property];
    },

    _notify: function (eventName) {
      if (typeof this.options[eventName] === 'function')
        this.options[eventName].apply(this, [].slice.call(arguments, 1));
    },

    _loadScript: function () {
      var self = this;
      return $.ajax({ url: this.options.script + (this.options.identifier || ''), dataType: 'script', timeout: this.options.scriptTimeout })
        .done(function () { self._notify('onScript'); })
        .fail(function () { self._notify('onScriptError'); });
    },

    boot: function (identifier) {
      if (!this.isEnabled())
        return false;
      this._notify('onBoot');
      return true;
    },

    isReady: function () {
      return typeof window.Intercom === 'function' && this.options;
    },

    isEnabled: function () {
      if (!this.isReady())
        return false;
      return this._get('isEnabled');
    },

    track: function (type, data, metadata, priority) {
      if (!type)
        return false;
      this.store(type, data, metadata, priority);
      if (this.isReady())
        this.flush();
      return true;
    },

    store: function (type, data, metadata, priority) {
      this._storedEvents = this._storedEvents || [];
      this._storedId = this._storedId || 0;
      // Build and store Deferred
      var _event = {
          id: ++this._storedId,
          dfd: $.Deferred(),
          type: type,
          data: data,
          metadata: metadata
        };

      if (priority !== true)
        this._storedEvents.push(_event);
      else
        this._storedEvents.unshift(_event);

      this._notify('onStore', _event);

      return _event;
    },

    flush: function () {
      var self = this,
          dfd = $.Deferred();

      if (this._dfd_flush)
        return this._dfd_flush;
      if (!this._storedEvents || !this._storedEvents.length)
        return dfd.resolve().promise();

      this._dfd_flush = dfd;

      var _event = this._storedEvents.shift();
      this._notify('onFlush', _event);

      switch (_event.type) {
        case 'trackEvent':
          this.intercomTrackEvent(_event);
          break;
        case 'shutdown':
          this.intercomShutdown(_event);
          break;
        case 'boot':
        case 'update':
          this.intercomUpdate(_event);
          break;
      }

      // Timeout: reject request after 5000ms
      setTimeout(function () {
        if (_event.dfd.state() === 'pending')
          _event.dfd.reject();
      }, this.options.trackTimeout);

      _event.dfd
        .done(function () { self._notify('onTrack', _event); })
        .fail(function () { self._notify('onTrackError', _event); })
        .always(function () {
          self._dfd_flush = null;
          setTimeout(function () {
            self.flush()
              .done(dfd.resolve);
          }, self.options.trackDelay);
        });
      return dfd.promise();
    },

    intercomShutdown: function (_event) {
      if (!this.isEnabled())
        return _event.dfd.reject().promise();

      // reset
      this._storedEvents = null;
      this._trackEventStack = null;
      this._pingStack = null;
      this._hasRegisteredIntercomEvents = false;
      this._fn_user_events_success = null;

      // call Intercom API
      window.Intercom('shutdown');

      // always resolve shutdown
      _event.dfd.resolve();
      return _event.dfd.promise();
    },

    intercomTrackEvent: function (_event) {
      if (!this.isEnabled())
        return _event.dfd.reject().promise();

      var self = this;

      // Wrap success_function_for_track_user_events (must be done before calling Itercom API)
      var fn_user_events_success = null;
      if (window.intercom_obj && window.intercom_obj.user_events && typeof window.intercom_obj.user_events.success_function_for_track_user_events === 'function') {
        fn_user_events_success = window.intercom_obj.user_events.success_function_for_track_user_events;

        this._trackEventStack = this._trackEventStack || [];
        this._trackEventStack.push(_event);

        if (!this._fn_user_events_success) {
          this._fn_user_events_success = function () {
            fn_user_events_success.apply(this, arguments);
            var _event = self._trackEventStack.shift();
            _event && _event.dfd && _event.dfd.resolve();
          };
          window.intercom_obj.user_events.success_function_for_track_user_events = this._fn_user_events_success;
        }
      }

      // call Intercom API
      window.Intercom(_event.type, _event.data, _event.metadata);

      if (!fn_user_events_success) {
        // we wont't be able to bind Intercom request completion
        _event.dfd.resolve();
      }

      // return Deferred promise
      return _event.dfd.promise();
    },

    intercomUpdate: function (_event) {
      if (!this.isEnabled())
        return _event.dfd.reject().promise();

      var self = this;

      // call Intercom API
      window.Intercom(_event.type, _event.data, _event.metadata);

      // Register Intercom event
      var fn_register = null;
      if (window.intercom_obj && window.intercom_obj.events && typeof window.intercom_obj.events.register_handler === 'function') {
        fn_register = window.intercom_obj.events.register_handler;

        this._pingStack = this._pingStack || [];
        this._pingStack.push(_event);

        if (!this._hasRegisteredIntercomEvents) {
          this._hasRegisteredIntercomEvents = true;
          // success
          fn_register('PROCESSED_PING', function () {
            var _event = self._pingStack.shift();
            _event && _event.dfd && _event.dfd.resolve();
          }, 0);
          // failure
          fn_register('API_DISABLED', function () {
            var _event = self._pingStack.shift();
            _event && _event.dfd && _event.dfd.reject();
          }, 0);
        }
      } else {
        // we wont't be able to bind Intercom request completion
        _event.dfd.resolve();
      }

      // return Deferred promise
      return _event.dfd.promise();
    }
  };

})(jQuery);

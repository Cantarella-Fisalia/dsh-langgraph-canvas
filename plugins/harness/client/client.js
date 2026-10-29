/**
 * Native Harness architecture view. No floating window or independent workspace.
 * UI-EMBED-001: user-authorized change across the integration boundary.
 */
;(function () {
  var loader = window.__ModuleLoader__
  if (!loader || typeof loader.load !== 'function') return
  var API_BASE = '/dsh-langgraph-canvas/api/v1'
  var APP_PATH = '/dsh-langgraph-canvas/app/?embedded=1&apiBase=' + encodeURIComponent(API_BASE)

  loader.load({
    id: 'dsh-langgraph-canvas',
    factory: function (require) {
      var React = require('react')
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useRef = React.useRef
      var useCallback = React.useCallback
      var useSyncExternalStore = React.useSyncExternalStore
      var EMPTY_FOCUS = { getSnapshot: function () { return null }, subscribe: function () { return function () {} } }

      function sameOrigin(event) {
        return event.origin === location.origin || (location.protocol === 'dsh-app:' &&
          (event.origin === 'null' || event.origin === location.protocol + '//' + location.host))
      }
      function themeContext(snapshot) {
        var style = getComputedStyle(document.body)
        var tokens = {}
        for (var i = 0; i < style.length; i++) {
          var key = style[i]
          if (/^--(?:dsw-|dsh-font-|ds-font-)[a-z0-9-]+$/i.test(key)) {
            var value = style.getPropertyValue(key).trim()
            if (value.length < 2000) tokens[key] = value
          }
        }
        return {
          colorScheme: snapshot.active.colorScheme,
          tokens: tokens,
          fontFamily: style.fontFamily,
        }
      }

      function ArchitectureView(props) {
        var frame = useRef(null)
        var focus = props.focusSource || EMPTY_FOCUS
        var focusedSession = useSyncExternalStore(focus.subscribe, focus.getSnapshot, focus.getSnapshot)
        var sessionId = props.sessionId || focusedSession
        var cwd = props.useSessions(function (state) {
          return state.byId[sessionId] ? state.byId[sessionId].cwd : ''
        })
        var workspacePath = props.useWorkspaces(function (state) {
          var workspace = state.items.find(function (item) { return item.sessionIds.includes(sessionId) })
          return workspace ? workspace.path : ''
        })
        var root = workspacePath || cwd || null
        var theme = useSyncExternalStore(props.themeSource.subscribe, props.themeSource.getSnapshot, props.themeSource.getSnapshot)
        var publish = useCallback(function () {
          var child = frame.current && frame.current.contentWindow
          if (!child) return
          child.postMessage({
            type: 'dsh-langgraph-canvas:host-context',
            schemaVersion: 1,
            workspaceRoot: root,
            sessionId: sessionId || null,
            theme: themeContext(theme),
          }, location.origin === 'null' ? '*' : location.origin)
        }, [root, theme, sessionId])

        useEffect(function () {
          function ready(event) {
            if (!frame.current || event.source !== frame.current.contentWindow || !sameOrigin(event)) return
            if (event.data && event.data.type === 'dsh-langgraph-canvas:ready' && event.data.schemaVersion === 1) publish()
          }
          window.addEventListener('message', ready)
          // Theme presenter may commit CSS variables after the theme/change event.
          var observer = new MutationObserver(publish)
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
          observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
          publish()
          return function () { window.removeEventListener('message', ready); observer.disconnect() }
        }, [publish])

        return h('section', {
          'data-dsh-langgraph-canvas-native-view': '',
          style: {
            display: 'flex', flex: '1 1 auto', width: '100%', minWidth: 0,
            height: '100%', minHeight: 360,
            overflow: 'hidden', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
          },
        }, h('iframe', {
          ref: frame, src: APP_PATH, title: '工作区架构', onLoad: publish,
          style: { width: '100%', height: '100%', flex: 1, border: 0, minWidth: 0, background: 'var(--dsw-alias-bg-base)' },
        }))
      }

      function ArchitectureEntry(props) {
        var sessionId = props.useSessions(function (state) {
          var rows = Object.values(state.byId)
          var selected = rows.find(function (row) { return row.retainedBy && row.retainedBy.mainView > 0 })
          return selected ? selected.id : null
        })
        return h('button', {
          type: 'button', title: '查看当前工作区架构',
          onClick: function () { props.openArchitecture(sessionId) },
          style: {
            border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '5px 10px',
            background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit',
            fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
          },
        }, '◇ 架构')
      }

      function StatusPanel() {
        var pair = useState('正在检测…')
        var status = pair[0]
        var setStatus = pair[1]
        useEffect(function () {
          var active = true
          fetch(API_BASE + '/health', { headers: { accept: 'application/json' } })
            .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json() })
            .then(function () { if (active) setStatus('解析服务正常') })
            .catch(function (error) { if (active) setStatus('解析服务未就绪：' + error.message) })
          return function () { active = false }
        }, [])
        return h('div', { style: { fontSize: 13, lineHeight: 1.8, color: 'var(--dsw-alias-label-primary)' } },
          h('strong', null, 'LangGraph 架构'),
          h('p', null, '独立社区插件；与 DeepSeek、LangChain 官方无隶属或背书关系。'),
          h('p', { style: { color: 'var(--dsw-alias-label-secondary)' } }, status),
          h('p', null, '在「对话／轨迹」旁选择「架构」；空白会话点击顶部「◇ 架构」。目录与当前工作区共用，主题跟随 Harness。'),
        )
      }

      function apply(ctx) {
        var focusedSession = null
        var focusListeners = new Set()
        var focusSource = {
          getSnapshot: function () { return focusedSession },
          subscribe: function (listener) { focusListeners.add(listener); return function () { focusListeners.delete(listener) } },
        }
        function openArchitecture(sessionId) {
          focusedSession = sessionId
          focusListeners.forEach(function (listener) { listener() })
          ctx.layout.selectPanel('dsh-langgraph-canvas.architecture')
        }
        var themeSource = {
          getSnapshot: function () { return ctx.theme.getTheme() },
          subscribe: function (listener) { return ctx.on('theme/change', listener) },
        }
        ctx.slots.inject('conversation.view', function () {
          return ctx.slots.register({
            name: 'conversation.view', id: 'dsh-langgraph-canvas', order: 20,
            label: function () { return '架构' },
            inject: function () { return { themeSource: themeSource } },
          }, ArchitectureView)
        })
        ctx.slots.inject('main', function () {
          return ctx.slots.register({
            name: 'main', key: 'dsh-langgraph-canvas.architecture',
            inject: function () { return { themeSource: themeSource, focusSource: focusSource } },
          }, ArchitectureView)
        })
        ctx.slots.inject('conversation.header.leading', function () {
          return ctx.slots.register({
            name: 'conversation.header.leading', id: 'dsh-langgraph-canvas-entry',
            inject: function () { return { openArchitecture: openArchitecture } },
          }, ArchitectureEntry)
        })
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section', id: 'dsh-langgraph-canvas', order: 40,
            label: function () { return 'LangGraph Canvas（非官方）' },
          }, StatusPanel)
        })
      }
      return { name: 'dsh-langgraph-canvas', inject: ['slots', 'theme', 'layout'], apply: apply }
    },
  })
})()

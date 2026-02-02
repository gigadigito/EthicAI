// wwwroot/js/dashboardHubWs.js
(function () {
    console.warn("[HubWS] script carregado");

    let connection = null;
    let dotnetRef = null;

    function W(...a) { console.warn("[HubWS]", ...a); }
    function E(...a) { console.error("[HubWS]", ...a); }

    async function start(url) {
        W("start() chamado", url);

        if (!window.signalR) {
            E("signalR JS NÃO encontrado em window");
            throw new Error("signalR JS não carregado");
        }

        W("signalR version:", window.signalR.VERSION || "(sem VERSION)");

        if (connection) {
            W("já existe conexão, parando antes de recriar");
            try { await connection.stop(); } catch (e) { E("erro ao stop()", e); }
            connection = null;
        }

        W("criando HubConnection (WebSockets only)");

        connection = new signalR.HubConnectionBuilder()
            .withUrl(url, {
                transport: signalR.HttpTransportType.WebSockets,
                skipNegotiation: true
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
            .configureLogging(signalR.LogLevel.Information)
            .build();

        W("HubConnection criada");

        connection.on("dashboard_changed", async (payload) => {
            W("EVENTO dashboard_changed RECEBIDO", payload);

            try {
                const json = payload == null ? null : JSON.stringify(payload);
                W("payload json:", json);

                if (!dotnetRef) {
                    W("dotnetRef AINDA NÃO setado");
                    return;
                }

                W("invocando Blazor OnDashboardChangedFromJs()");
                await dotnetRef.invokeMethodAsync("OnDashboardChangedFromJs", json);
                W("invokeMethodAsync OK");
            } catch (e) {
                E("erro no handler dashboard_changed", e);
            }
        });

        connection.onreconnecting(e =>
            W("RECONNECTING", e?.message || e)
        );

        connection.onreconnected(id =>
            W("RECONNECTED connId=", id)
        );

        connection.onclose(e =>
            W("CLOSED", e?.message || e)
        );

        W("chamando connection.start()");
        await connection.start();

        W("connection.start OK");
        W("state=", connection.state, "connId=", connection.connectionId);

        return connection.connectionId || "";
    }

    async function stop() {
        W("stop() chamado");
        if (!connection) {
            W("não existe conexão para parar");
            return;
        }
        await connection.stop();
        W("conexão parada");
        connection = null;
    }

    function setDotnetRef(ref) {
        W("setDotnetRef()", ref ? "OK" : "NULL");
        dotnetRef = ref;
    }

    function state() {
        const s = connection ? connection.state : "Disconnected";
        W("state()", s);
        return s;
    }

    window.DashboardHubWs = {
        start,
        stop,
        setDotnetRef,
        state
    };

    W("DashboardHubWs exposto em window");
})();

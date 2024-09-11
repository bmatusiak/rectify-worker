(function WorkerPlugin() {
    plugin.consumes = ["app"];
    plugin.provides = ["worker"];

    async function plugin({ app }, register) {
        const { fork } = require('child_process');
        var eventBridge = require("./eventBridge.js");
        function WorkerNode(src, name) {
            const forked = fork(src, ["--name", name], {
                execArgv: ['--expose-gc']//removed any pre-args
            });
            forked.on('message', (msg) => (msg == "stop" ? this.stop() : this.onmessage && this.onmessage(msg)));
            forked.on('close', () => { this.postMessage = () => { }; });
            this.postMessage = (msg) => { if (forked.connected && !forked.killed) forked.send(msg); };
            this._ = forked;
            this.stop = () => { forked.kill(); };
        }
        function NodeWorkerClient() {
            process.on('message', (msg) => this.onmessage && this.onmessage(msg));
            this.postMessage = (msg) => process.send(msg);
            this._ = process;
            this.stop = () => { this.postMessage("stop"); };
        }
        function WorkerWeb(src, name) {
            const worker = new Worker(src, { name });
            worker.onmessage = (msg) => (msg.data == "stop" ? this.stop() : this.onmessage && this.onmessage(msg.data));
            this.postMessage = (msg) => worker.postMessage(msg);
            this._ = worker;
            this.stop = () => { worker.terminate(); };
        }
        function WebWorkerClient() {
            globalThis.onmessage = (msg) => (this.onmessage && this.onmessage(msg.data));
            this.postMessage = (msg) => globalThis.postMessage(msg);
            this._ = globalThis;
            this.stop = () => { this.postMessage("stop"); };
        }
        var { isWorker, isFork, EventEmitter } = app;
        var worker_plugin = new EventEmitter();
        app.on("start_worker", function () {
            var parent;
            if (isWorker) {
                parent = new WebWorkerClient();
            }
            if (isFork) {
                parent = new NodeWorkerClient();
            }
            parent.onmessage = (ack) => {
                var [msg_id, msg] = ack;
                switch (msg_id) {
                    case 'worker_id':
                        var worker_id = msg;
                        parent.name = "parent";
                        parent.bridge = eventBridge(parent);
                        worker_plugin._parent = parent;
                        worker_plugin.parent = parent.bridge;
                        worker_plugin.emit(worker_id, parent.bridge, parent);
                        parent.postMessage(["worker_ready", "get"]);
                        break;
                }
            };
            parent.postMessage(["worker_id", "get"]);
        });
        worker_plugin.workers = {};
        worker_plugin.start = function (id, callback) {
            var worker;
            if (!app.isNode) {
                worker = new WorkerWeb("./worker.js", id);
            } else {
                worker = new WorkerNode("./src/worker.js", id);
            }
            worker.onmessage = (ack) => {
                var [msg_id, msg] = ack;
                if (msg == "get")
                    switch (msg_id) {
                        case 'worker_id':
                            worker.postMessage(["worker_id", id, msg]);
                            break;
                        case 'worker_ready':
                            worker.bridge = eventBridge(worker);
                            worker_plugin.workers[id] = worker;
                            callback(worker.bridge, worker);
                            break;
                    }
            };
            return worker;
        };
        await register(null, {
            worker: worker_plugin
        });
    }
    module.exports = plugin;
})();

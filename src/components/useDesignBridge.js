import { useEffect, useRef, useState } from 'react';
import { DESIGN_API_VERSION } from '../application/designContract.js';

// Static deployments do nothing: only a loopback launcher URL opts into the bridge.
function connectionToken() {
  if (location.hostname !== '127.0.0.1') return null;
  const fragment = new URLSearchParams(location.hash.slice(1));
  return fragment.get('facet-mcp');
}
export function useDesignBridge(handle) {
  const handler = useRef(handle);
  handler.current = handle;
  const [token] = useState(connectionToken);
  const [status, setStatus] = useState(token ? 'connecting' : 'off');
  const [sessionId, setSessionId] = useState(null);
  const socketRef = useRef(null);
  const disabled = useRef(false);
  useEffect(() => {
    if (!token) return;
    let stopped = false,
      retry;
    function connect() {
      if (stopped || disabled.current) return;
      setStatus('connecting');
      const socket = new WebSocket(
        `ws://${location.host}/__design_bridge?token=${encodeURIComponent(token)}`,
      );
      socketRef.current = socket;
      socket.onopen = async () => {
        try {
          const stamp = await fetch('/design-build.json', {
            cache: 'no-store',
          }).then((response) => response.json());
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                type: 'hello',
                apiVersion: DESIGN_API_VERSION,
                sourceHash: stamp.sourceHash,
              }),
            );
        } catch {
          socket.close(1008, 'Missing build stamp');
        }
      };
      let queue = Promise.resolve();
      socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.type === 'welcome') {
          setStatus('connected');
          setSessionId(message.sessionId);
          return;
        }
        queue = queue.then(async () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          let reply;
          try {
            if (Date.now() > message.deadline)
              throw Object.assign(new Error('请求已过期，请重新读取状态。'), {
                code: 'REQUEST_EXPIRED',
              });
            reply = {
              id: message.id,
              result: await handler.current(message.name, message.args, {
                async exportArtifact(blob) {
                  if (
                    socket.readyState !== WebSocket.OPEN ||
                    Date.now() > message.deadline
                  )
                    throw new Error('PDF request expired.');
                  const response = await fetch(
                    `/__design_artifact?token=${encodeURIComponent(token)}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': blob.type },
                      body: blob,
                    },
                  );
                  if (!response.ok)
                    throw new Error(
                      'PDF could not be stored by the local service.',
                    );
                  return response.json();
                },
                assertLive() {
                  if (
                    socket.readyState !== WebSocket.OPEN ||
                    Date.now() > message.deadline
                  )
                    throw Object.assign(
                      new Error('连接或请求已过期，请重新读取。'),
                      { code: 'REQUEST_EXPIRED' },
                    );
                },
              }),
            };
          } catch (error) {
            reply = {
              id: message.id,
              error: {
                code: error.code ?? 'DESIGN_ERROR',
                message: error.message,
                details: error.details,
              },
            };
          }
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify(reply));
        });
      };
      socket.onclose = (event) => {
        if (event.code === 1008) disabled.current = true;
        if (!stopped) {
          setStatus(disabled.current ? 'off' : 'disconnected');
          setSessionId(null);
          retry = setTimeout(connect, 1500);
        }
      };
      socket.onerror = () => socket.close();
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [token]);
  return {
    enabled: Boolean(token),
    status,
    sessionId,
    disconnect: () => {
      disabled.current = true;
      socketRef.current?.close();
      setStatus('off');
    },
  };
}

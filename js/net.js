// P2P-сеть через Trystero (WebRTC). Сигналинг идёт через публичные Nostr-релеи,
// поэтому собственный сервер не нужен — игра работает прямо с GitHub Pages.
const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.25.4/+esm';
const APP_ID = 'three-mini-mmo-2026';
const ROOM = 'world-1';

export async function connectNet(h) {
  const { joinRoom, selfId } = await import(TRYSTERO_URL);
  const room = joinRoom({ appId: APP_ID }, ROOM);

  const action = (name, onMessage) => {
    const a = room.makeAction(name);
    a.onMessage = (data, meta) => onMessage(meta?.peerId ?? meta, data);
    return data => a.send(data);
  };

  const sendState = action('st', h.onState);
  const sendChat = action('chat', h.onChat);
  const sendHit = action('bhit', h.onBossHit);
  room.onPeerJoin = id => h.onJoin?.(id);
  room.onPeerLeave = id => h.onLeave?.(id);

  return { selfId, sendState, sendChat, sendHit, leave: () => room.leave() };
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clipboard, Clock3, Crown, DoorOpen, Gamepad2, Heart, Link2, LoaderCircle, LockKeyhole, MessageCircle, Plus, RefreshCw, Send, Sparkles, Users, X, Zap } from 'lucide-react'
import { isOnlineConfigured, supabase } from './lib/supabase'
import { makeCode, makeId, normalizeWord, validateWord } from './lib/game'
import './style.css'

const STORE = 'dong-dieu-player'
const readSaved = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') } catch { return {} } }
const save = (v) => localStorage.setItem(STORE, JSON.stringify(v))

function App() {
  const [screen, setScreen] = useState('home')
  const [name, setName] = useState(readSaved().name || '')
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room') || '')
  const [room, setRoom] = useState(null)
  const [player, setPlayer] = useState(null)
  const [players, setPlayers] = useState([])
  const [rounds, setRounds] = useState([])
  const [word, setWord] = useState('')
  const [seconds, setSeconds] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [demo, setDemo] = useState(!isOnlineConfigured)
  const inputRef = useRef(null)
  const finalizedRound = useRef(null)
  const currentPlayer = players.find(p => p.id === player?.id)
  const opponent = players.find(p => p.id !== player?.id)
  const currentRound = rounds[rounds.length - 1]
  const mySubmitted = Boolean(currentRound?.submissions?.[player?.id])
  const readyCount = players.filter(p => p.ready).length
  const gameUrl = `${location.origin}${location.pathname}?room=${room?.code || code}`

  useEffect(() => { if (name) save({ ...readSaved(), name }) }, [name])
  useEffect(() => {
    if (screen !== 'game' || !room || room.status !== 'playing') return
    const tick = () => {
      const end = room.roundStartedAt + 10000
      setSeconds(Math.max(0, Math.ceil((end - Date.now()) / 1000)))
      if (Date.now() >= end) finishRoundIfNeeded()
    }
    tick(); const id = setInterval(tick, 150)
    return () => clearInterval(id)
  }, [screen, room?.roundStartedAt, room?.status, rounds, player?.id])

  useEffect(() => {
    const saved = readSaved()
    if (isOnlineConfigured && saved.roomCode && saved.token && saved.playerId) {
      setDemo(false)
      setRoom({ code: saved.roomCode, status: 'waiting', round: 0, roundStartedAt: 0 })
      setPlayer({ id: saved.playerId, token: saved.token, name: saved.name || 'Người chơi' })
    }
  }, [])

  useEffect(() => {
    if (!room || demo || !supabase || !player) return
    refreshOnline()
    const poll = setInterval(refreshOnline, 1800)
    return () => clearInterval(poll)
  }, [room?.code, demo, player?.id])

  async function refreshOnline() {
    if (!supabase || !room || !player) return
    const { data, error: e } = await supabase.rpc('get_room_state', { p_code: room.code, p_token: player.token })
    if (e) { setError(e.message); return }
    if (!data?.room) return
    setRoom({ ...data.room, roundStartedAt: data.room.round_started_at ? new Date(data.room.round_started_at).getTime() : 0 })
    setPlayers(data.players || [])
    setRounds(data.rounds || [])
    if (data.room.status === 'finished') setScreen('result')
    else if (data.room.status === 'playing') setScreen('game')
    else setScreen('lobby')
  }

  function enterRoom(nextRoom, nextPlayer, nextPlayers = [], nextRounds = []) {
    setRoom(nextRoom); setPlayer(nextPlayer); setPlayers(nextPlayers); setRounds(nextRounds)
    save({ ...readSaved(), name, roomCode: nextRoom.code, token: nextPlayer.token, playerId: nextPlayer.id, demo })
    setError(''); setScreen(nextRoom.status === 'playing' ? 'game' : nextRoom.status === 'finished' ? 'result' : 'lobby')
  }

  async function createRoom() {
    if (!name.trim()) return setError('Hãy nhập tên của bạn trước nhé.')
    setBusy(true); setError('')
    try {
      const token = makeId()
      if (demo) {
        const r = { code: makeCode(), status: 'waiting', round: 0, roundStartedAt: 0, createdAt: Date.now() }
        const p = { id: makeId(), token, name: name.trim(), ready: false }
        enterRoom(r, p, [p])
      } else {
        const { data, error: e } = await supabase.rpc('create_room', { p_name: name.trim(), p_token: token })
        if (e) throw e
        const r = { code: data.code, status: 'waiting', round: 0, roundStartedAt: 0 }
        enterRoom(r, { id: data.player_id, token, name: name.trim(), ready: false }, [{ id: data.player_id, name: name.trim(), ready: false }])
        await refreshOnline()
      }
    } catch (e) { setError(e.message || 'Không thể tạo phòng.') }
    finally { setBusy(false) }
  }

  async function joinRoom() {
    if (!name.trim()) return setError('Hãy nhập tên của bạn trước nhé.')
    if (!/^\d{6}$/.test(code)) return setError('Mã phòng phải gồm đúng 6 chữ số.')
    setBusy(true); setError('')
    try {
      if (demo) {
        const saved = readSaved()
        if (saved.roomCode !== code || !saved.token) throw new Error('Chế độ demo chỉ chạy một người trên một trình duyệt. Hãy cấu hình Supabase để mời bạn bè online.')
        throw new Error('Để tham gia từ thiết bị khác, hãy cấu hình Supabase theo README.')
      }
      const token = makeId()
      const { data, error: e } = await supabase.rpc('join_room', { p_code: code, p_name: name.trim(), p_token: token })
      if (e) throw e
      enterRoom({ code, status: 'waiting', round: 0 }, { id: data.player_id, token, name: name.trim(), ready: false })
      await refreshOnline()
    } catch (e) { setError(e.message || 'Không thể tham gia phòng.') }
    finally { setBusy(false) }
  }

  async function setReady() {
    if (demo) {
      setPlayers(ps => ps.map(p => p.id === player.id ? { ...p, ready: !p.ready } : p))
      setNotice('Chế độ demo: cần Supabase để người chơi thứ hai cùng sẵn sàng.')
      return
    }
    const { error: e } = await supabase.rpc('set_player_ready', { p_code: room.code, p_token: player.token, p_ready: !currentPlayer?.ready })
    if (e) setError(e.message); else refreshOnline()
  }

  async function startGame() {
    if (demo) {
      setError('Để chơi thật với hai người ở hai thiết bị, hãy cấu hình Supabase theo README.')
      return
    }
    const { error: e } = await supabase.rpc('start_game', { p_code: room.code, p_token: player.token })
    if (e) setError(e.message); else refreshOnline()
  }

  async function submitWord() {
    const validation = validateWord(word)
    if (validation) return setError(validation)
    if (mySubmitted || busy) return
    setBusy(true); setError('')
    try {
      if (demo) {
        setRounds(rs => {
          const copy = [...rs]; const last = copy[copy.length - 1] || { number: 1, submissions: {} }
          last.submissions[player.id] = word.trim().replace(/\s+/g, ' ')
          copy[copy.length - 1] = last; return copy
        })
        setWord(''); setNotice('Đã ghi nhận từ của bạn. Chế độ demo không có người chơi thứ hai.')
      } else {
        const { error: e } = await supabase.rpc('submit_word', { p_code: room.code, p_token: player.token, p_round: room.round, p_word: word.trim().replace(/\s+/g, ' ') })
        if (e) throw e
        setWord(''); await refreshOnline()
      }
    } catch (e) { setError(e.message || 'Không gửi được từ.') }
    finally { setBusy(false) }
  }

  async function finishRoundIfNeeded() {
    if (demo || !supabase || !room || !player || finalizedRound.current === room.round) return
    finalizedRound.current = room.round
    const { error: e } = await supabase.rpc('finish_expired_round', { p_code: room.code })
    if (e) setError(e.message)
    await refreshOnline()
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(gameUrl); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch { setNotice(`Link mời: ${gameUrl}`) }
  }

  async function leaveRoom() {
    if (!demo && supabase && room && player) await supabase.rpc('leave_room', { p_code: room.code, p_token: player.token })
    setRoom(null); setPlayer(null); setPlayers([]); setRounds([]); setWord(''); setError(''); setScreen('home')
    const s = readSaved(); delete s.roomCode; delete s.token; delete s.playerId; save(s)
    history.replaceState({}, '', location.pathname)
  }

  async function playAgain() {
    if (demo) { setError('Chế độ demo chưa hỗ trợ chơi lại trực tuyến.'); return }
    const { error: e } = await supabase.rpc('play_again', { p_code: room.code, p_token: player.token })
    if (e) setError(e.message); else refreshOnline()
  }

  const matchedRound = rounds.find(r => r.is_match)
  const duration = room?.createdAt ? Math.max(1, Math.round((Date.now() - room.createdAt) / 1000)) : 0

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => screen === 'home' ? null : leaveRoom()}><span className="brand-mark"><Sparkles size={19}/></span><span>đồng điệu<span className="brand-dot">.</span><small>THINK ALIKE</small></span></button><div className="top-right"><span className={`connection ${demo ? 'demo' : 'live'}`}><i/> {demo ? 'Bản xem trước' : 'Online'}</span><button className="help-btn" onClick={() => setNotice('Mỗi lượt có 10 giây. Hãy nhập một cụm gồm 2–3 tiếng. Hai từ giống nhau sẽ kết thúc trò chơi!')}>Cách chơi</button></div></header>
    <main>
      {screen === 'home' && <section className="hero fade-in">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-icon"><Heart size={13} fill="currentColor"/></span> MỘT TRÒ CHƠI NHỎ, MỘT SỰ ĐỒNG ĐIỆU LỚN</div><h1>Hai tâm trí.<br/><span>Một suy nghĩ.</span></h1><p className="hero-desc">Bạn và người ấy có thật sự hiểu nhau? Cùng nghĩ ra một từ, cùng chạm đến một đáp án.</p>
          <div className="hero-actions"><button className="btn btn-primary btn-large" onClick={() => {setError('');setScreen('create')}}><Plus size={19}/> Tạo phòng mới <ArrowRight size={17}/></button><button className="btn btn-secondary btn-large" onClick={() => {setError('');setScreen('join')}}><DoorOpen size={18}/> Tham gia phòng</button></div>
          <div className="hero-meta"><span><Users size={15}/> 2 người chơi</span><span><Clock3 size={15}/> 10 giây mỗi lượt</span><span><Zap size={15}/> Không cần tài khoản</span></div>
        </div>
        <div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="spark s1">✦</div><div className="spark s2">✧</div><div className="thought thought-left"><span>☁</span><b>Mùa hè</b></div><div className="thought thought-right"><span>☁</span><b>Mùa hè</b></div><div className="brain-card"><div className="brain-glow"><span>✿</span></div><div className="brain-caption">SAME<br/>WAVELENGTH</div></div><div className="match-pill"><CheckCircle2 size={16}/> Trùng khớp!</div><div className="art-caption">somewhere between<br/>your thoughts & mine</div></div>
        <div className="how-strip"><div className="how-title"><span className="tiny-icon"><Gamepad2 size={17}/></span><b>Chơi cực đơn giản</b></div><div className="how-step"><span>01</span><p>Tạo phòng &<br/>mời bạn bè</p></div><ArrowRight className="step-arrow" size={17}/><div className="how-step"><span>02</span><p>Cùng nhập từ<br/>trong 10 giây</p></div><ArrowRight className="step-arrow" size={17}/><div className="how-step"><span>03</span><p>Đoán ý nhau<br/>đến khi trùng</p></div></div>
      </section>}

      {(screen === 'create' || screen === 'join') && <section className="form-page fade-in"><button className="back-link" onClick={() => {setScreen('home');setError('')}}><ArrowLeft size={16}/> Quay lại</button><div className="form-card"><div className="form-icon">{screen === 'create' ? <Plus size={24}/> : <DoorOpen size={24}/>}</div><div className="eyebrow center">BẮT ĐẦU CUỘC CHƠI</div><h2>{screen === 'create' ? 'Tạo một căn phòng' : 'Vào phòng bạn bè'}</h2><p className="form-sub">{screen === 'create' ? 'Tạo phòng riêng rồi gửi lời mời đến người bạn muốn chơi cùng.' : 'Nhập mã 6 chữ số mà bạn bè đã gửi cho bạn.'}</p><label className="field-label">Tên hiển thị</label><input className="text-input" maxLength={18} placeholder="Ví dụ: Mây, Bắp, Minh..." value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && (screen === 'create' ? createRoom() : joinRoom())}/>{screen === 'join' && <><label className="field-label code-label">Mã phòng</label><input className="text-input code-input" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))} onKeyDown={e => e.key === 'Enter' && joinRoom()}/></>}{error && <div className="error-msg"><X size={15}/>{error}</div>}<button className="btn btn-primary submit-btn" disabled={busy} onClick={screen === 'create' ? createRoom : joinRoom}>{busy ? <LoaderCircle className="spin" size={18}/> : screen === 'create' ? <><Plus size={18}/> Tạo phòng ngay</> : <><DoorOpen size={18}/> Tham gia phòng</>}</button><div className="privacy-note"><LockKeyhole size={13}/> Không cần đăng ký tài khoản</div></div></section>}

      {screen === 'lobby' && room && <section className="lobby-page fade-in"><div className="section-kicker">PHÒNG CHỜ</div><h2>Sắp đồng điệu rồi!</h2><p className="section-sub">Chia sẻ mã phòng cho người bạn muốn chơi cùng nhé.</p><div className="room-code-card"><span>MÃ PHÒNG CỦA BẠN</span><div className="room-code">{room.code.split('').map((n,i)=><b key={i}>{n}</b>)}</div><button className="copy-link" onClick={copyInvite}><Link2 size={15}/>{copied ? 'Đã sao chép link!' : 'Sao chép link mời'}</button></div><div className="players-grid"><PlayerCard player={players[0] || player} self/><div className="versus">VS</div><PlayerCard player={opponent} waiting={!opponent}/></div><div className="lobby-status"><span className="pulse-dot"/>{players.length < 2 ? 'Đang chờ người chơi thứ hai...' : readyCount === 2 ? 'Cả hai đã sẵn sàng!' : 'Đã đủ người chơi – cùng sẵn sàng nhé!'}</div>{error && <div className="error-msg centered">{error}</div>}<div className="lobby-actions"><button className={`btn ${currentPlayer?.ready ? 'btn-ready' : 'btn-primary'} btn-large`} onClick={setReady}><Check size={18}/>{currentPlayer?.ready ? 'Bạn đã sẵn sàng' : 'Tôi đã sẵn sàng'}</button><button className="btn btn-secondary btn-large" disabled={players.length < 2 || readyCount !== 2} onClick={startGame}>Bắt đầu chơi <ArrowRight size={17}/></button></div><button className="text-action" onClick={leaveRoom}>Rời phòng</button></section>}

      {screen === 'game' && room && <section className="game-page fade-in"><div className="game-topline"><div><span className="section-kicker">ĐANG CHƠI</span><div className="game-room">Phòng <b>#{room.code}</b></div></div><div className="round-chip">LƯỢT <b>{room.round || rounds.length || 1}</b></div></div><div className="timer-wrap"><div className={`timer-ring ${seconds <= 3 ? 'urgent' : ''}`}><svg viewBox="0 0 120 120"><circle className="timer-track" cx="60" cy="60" r="52"/><circle className="timer-progress" cx="60" cy="60" r="52" style={{strokeDashoffset: 326.7 * (1 - seconds/10)}}/></svg><div className="timer-number"><strong>{seconds}</strong><small>GIÂY</small></div></div><p>{seconds > 0 ? 'Một từ đang ở trong đầu bạn là gì?' : 'Đang chốt lượt...'}</p></div><div className="game-players"><div className="game-player"><div className="avatar avatar-blue">{(player?.name || 'B').slice(0,1).toUpperCase()}</div><b>{player?.name} <small>(Bạn)</small></b><span className={mySubmitted ? 'sent-state' : 'waiting-state'}>{mySubmitted ? <><CheckCircle2 size={13}/> Đã gửi từ</> : 'Đang suy nghĩ...'}</span></div><div className="game-divider"><span>♡</span></div><div className="game-player"><div className="avatar avatar-pink">{(opponent?.name || '?').slice(0,1).toUpperCase()}</div><b>{opponent?.name || 'Bạn chơi'} </b><span className={currentRound?.submissions?.[opponent?.id] ? 'sent-state' : 'waiting-state'}>{currentRound?.submissions?.[opponent?.id] ? <><CheckCircle2 size={13}/> Đã gửi từ</> : 'Đang suy nghĩ...'}</span></div></div><div className="word-entry"><label htmlFor="word">TỪ CỦA BẠN</label><div className="input-row"><input ref={inputRef} id="word" autoComplete="off" maxLength={40} disabled={mySubmitted || seconds === 0} placeholder="Ví dụ: Bầu trời..." value={word} onChange={e => setWord(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitWord()}/><button className="send-btn" disabled={mySubmitted || seconds === 0 || busy} onClick={submitWord}>{busy ? <LoaderCircle className="spin"/> : <Send size={18}/>}</button></div><div className="entry-hint">Một cụm từ gồm <b>2 hoặc 3 tiếng</b> · Không phân biệt viết hoa</div>{mySubmitted && <div className="submitted-note"><CheckCircle2 size={16}/> Đã khóa câu trả lời. Chờ người kia nhé!</div>}{error && <div className="error-msg">{error}</div>}</div><div className="history"><div className="history-head"><b><MessageCircle size={16}/> Những lượt trước</b><span>{rounds.filter(r => r.resolved).length} lượt</span></div>{rounds.filter(r => r.resolved).length === 0 ? <div className="empty-history">Những từ đầu tiên sẽ xuất hiện ở đây. Cố gắng tìm điểm chung nhé!</div> : <div className="history-list">{rounds.filter(r => r.resolved).slice(-4).map(r => <div className="history-row" key={r.number}><span>#{r.number}</span><b>{r.words?.[0] || 'Bỏ lượt'}</b><i>↔</i><b>{r.words?.[1] || 'Bỏ lượt'}</b><em>{r.is_match ? 'Trùng!' : 'Khác nhau'}</em></div>)}</div>}</div><button className="text-action" onClick={leaveRoom}>Rời trò chơi</button></section>}

      {screen === 'result' && <section className="result-page fade-in"><div className="win-confetti">✦　✧　✦</div><div className="result-icon"><Crown size={34}/></div><div className="eyebrow center">ĐIỀU KỲ DIỆU ĐÃ XẢY RA</div><h2>Hai bạn thật<br/><span>đồng điệu!</span></h2><p className="section-sub">Không cần hẹn trước, hai tâm trí đã tìm thấy nhau.</p><div className="matched-word">{matchedRound?.words?.[0] || 'Mùa hè'}<span>♡</span></div><div className="result-stats"><div><b>{rounds.length}</b><span>Tổng lượt</span></div><div><b>{duration || '—'}s</b><span>Thời gian</span></div><div><b>02</b><span>Người chơi</span></div></div><div className="result-history"><b>Lịch sử đồng điệu</b>{rounds.filter(r => r.resolved).map(r => <div className="history-row" key={r.number}><span>#{r.number}</span><b>{r.words?.[0] || 'Bỏ lượt'}</b><i>↔</i><b>{r.words?.[1] || 'Bỏ lượt'}</b><em>{r.is_match ? '♡ Trùng!' : 'Khác'}</em></div>)}</div>{error && <div className="error-msg">{error}</div>}<div className="result-actions"><button className="btn btn-primary btn-large" onClick={playAgain}><RefreshCw size={17}/> Chơi lại cùng nhau</button><button className="btn btn-secondary btn-large" onClick={leaveRoom}>Về trang chủ</button></div></section>}
    </main>
    <footer><span>đồng điệu<span className="brand-dot">.</span> <small>MADE FOR TWO MINDS</small></span><span>Ít nhất một lần, hãy thử nghĩ giống nhau. ♡</span></footer>
    {notice && <div className="toast" onClick={() => setNotice('')}><Sparkles size={16}/>{notice}<button><X size={15}/></button></div>}
    {demo && screen !== 'home' && <div className="demo-banner"><span><Sparkles size={14}/> ĐANG Ở CHẾ ĐỘ XEM TRƯỚC</span><small>Thêm Supabase để chơi online với bạn bè</small></div>}
  </div>
}

function PlayerCard({ player, self, waiting }) {
  return <div className={`player-card ${waiting ? 'player-waiting' : ''}`}><div className={`avatar ${self ? 'avatar-blue' : 'avatar-pink'}`}>{waiting ? <Users size={22}/> : (player?.name || '?').slice(0,1).toUpperCase()}</div><b>{waiting ? 'Đang chờ...' : player?.name}</b><span className={waiting ? 'waiting-state' : player?.ready ? 'sent-state' : 'waiting-state'}>{waiting ? 'Chưa tham gia' : player?.ready ? <><CheckCircle2 size={13}/> Sẵn sàng</> : 'Chưa sẵn sàng'}</span></div>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)

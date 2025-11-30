import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User, Cpu, Trophy, RotateCcw, X, Circle, Play, Users, ArrowRight, Copy, Check, Smartphone } from 'lucide-react';
import { initializeApp } from 'firebase/app';
// Eliminada signInWithCustomToken ya que no se usa tras quitar la variable global
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'; 
import { getFirestore, doc, setDoc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';

// --- Combinaciones ganadoras (MOVÍ LA CONSTANTE FUERA del componente para resolver ESLint) ---
const winningCombinations = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

// --- FIREBASE SETUP ---
// ¡CRÍTICO! REEMPLAZA ESTE OBJETO CON TUS DATOS REALES DE FIREBASE (Ver Guía Parte 1, Paso 4)
// ¡Asegúrate de haber pegado tus valores aquí!
const firebaseConfig = {
  apiKey: "AIzaSyB2TwbCngbXGL-Eeblymfxtj0_QKNFnaMs",
  authDomain: "tresenraya-403d7.firebaseapp.com",
  projectId: "tresenraya-403d7",
  storageBucket: "tresenraya-403d7.firebasestorage.app",
  messagingSenderId: "947519958602",
  appId: "1:947519958602:web:909b15f265a5bb92df80b3",
  measurementId: "G-QGDT959GP5"
};

// Se usa el projectId como identificador público de la aplicación
const appId = firebaseConfig.projectId;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TresEnRaya = () => {
    // --- ESTADOS ---
    const [user, setUser] = useState(null);
    const [view, setView] = useState('setup'); // setup, menu, lobby, game
    const [gameMode, setGameMode] = useState(null); // 'bot', 'online', 'local'
    const [playerName, setPlayerName] = useState('');
    const [joinCode, setJoinCode] = useState('');
    const [roomId, setRoomId] = useState(null);
    
    // Estados del Juego
    const [board, setBoard] = useState(Array(9).fill(null));
    const [turn, setTurn] = useState('X'); // De quién es el turno actual
    const [myRole, setMyRole] = useState(null); // 'X' o 'O' (para online)
    const [winner, setWinner] = useState(null);
    const [winningLine, setWinningLine] = useState([]); // Indices de la línea ganadora
    const [scores, setScores] = useState({ X: 0, O: 0 });
    const [roundStarter, setRoundStarter] = useState('X'); // Quién empieza esta ronda
    const [opponentName, setOpponentName] = useState('Esperando...');
    const [seriesWinner, setSeriesWinner] = useState(null);
    
    // UI Feedback
    const [copied, setCopied] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    // Referencias
    const unsubscribeRef = useRef(null);
    
    // --- INICIALIZACIÓN Y AUTH ---
    useEffect(() => {
        const initAuth = async () => {
            await signInAnonymously(auth);
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsubscribe();
    }, []); // Dependencia vacía para que se ejecute solo una vez

    // --- FUNCIONES CENTRALES DEL JUEGO (Definidas temprano) ---

    // Función pura para verificar ganador
    const checkWinner = useCallback((squares) => {
        for (let combo of winningCombinations) {
            const [a, b, c] = combo;
            if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
                return { winner: squares[a], line: combo };
            }
        }
        return squares.every(square => square !== null) ? { winner: 'Draw', line: [] } : null;
    }, []);

    // Función para actualizar estados locales al finalizar una ronda
    const handleGameEnd = useCallback((result) => {
        setWinner(result.winner);
        setWinningLine(result.line);
        if (result.winner !== 'Draw') {
            // scores es una dependencia de useCallback, pero se actualiza usando el estado previo, lo que es seguro.
            setScores(prev => ({ ...prev, [result.winner]: prev[result.winner] + 1 }));
        }
    }, []); // No necesita dependencias ya que scores se maneja con la función de actualización de estado.

    // Lógica para elegir el movimiento del BOT
    const findBestMove = useCallback((currentBoard, symbol) => {
        for (let combo of winningCombinations) {
            const [a, b, c] = combo;
            const vals = [currentBoard[a], currentBoard[b], currentBoard[c]];
            if (vals.filter(v => v === symbol).length === 2 && vals.filter(v => v === null).length === 1) {
                return combo[vals.indexOf(null)];
            }
        }
        return -1;
    }, []); // winningCombinations es una constante externa

    const makeBotMove = useCallback(() => {
        const newBoard = [...board];
        let moveIndex = -1;
        
        // 1. Intentar ganar
        moveIndex = findBestMove(newBoard, 'O');
        // 2. Bloquear
        if (moveIndex === -1) moveIndex = findBestMove(newBoard, 'X');
        // 3. Centro
        if (moveIndex === -1 && !newBoard[4]) moveIndex = 4;
        // 4. Azar
        if (moveIndex === -1) {
            const empty = newBoard.map((v, i) => v === null ? i : null).filter(v => v !== null);
            // Math.random() se llama dentro de la función makeBotMove, lo cual es correcto
            if (empty.length) moveIndex = empty[Math.floor(Math.random() * empty.length)];
        }

        if (moveIndex !== -1) {
            newBoard[moveIndex] = 'O';
            setBoard(newBoard);
            const result = checkWinner(newBoard);
            if (result) handleGameEnd(result);
            else setTurn('X');
        }
    }, [board, findBestMove, handleGameEnd, checkWinner]); // Dependencias checkWinner y board añadidas

    // Efecto para el movimiento del BOT
    useEffect(() => {
        if (gameMode === 'bot' && turn === 'O' && !winner && !seriesWinner) {
            const timer = setTimeout(makeBotMove, 600);
            return () => clearTimeout(timer);
        }
    }, [turn, winner, seriesWinner, gameMode, makeBotMove]); 

    // Verificar fin de serie - usar estado derivado
    const derivedSeriesWinner = seriesWinner || (scores.X >= 3 ? 'X' : scores.O >= 3 ? 'O' : null);
    
    // Actualizar seriesWinner si cambió el derivado
    if (derivedSeriesWinner && derivedSeriesWinner !== seriesWinner) {
        setSeriesWinner(derivedSeriesWinner);
    }


    // --- RESTO DE LA LÓGICA DEL JUEGO (sin cambios mayores) ---

    const startBotGame = () => {
        setGameMode('bot');
        setMyRole('X'); 
        setOpponentName('Bot');
        setScores({ X: 0, O: 0 });
        setBoard(Array(9).fill(null));
        setTurn('X');
        setRoundStarter('X');
        setWinner(null);
        setWinningLine([]);
        setSeriesWinner(null);
        setView('game');
    };

    const startLocalGame = () => {
        setGameMode('local');
        setMyRole(null); 
        setOpponentName('Jugador 2');
        setScores({ X: 0, O: 0 });
        setBoard(Array(9).fill(null));
        setTurn('X');
        setRoundStarter('X');
        setWinner(null);
        setWinningLine([]);
        setSeriesWinner(null);
        setView('game');
    };

    const handleOfflineClick = (index) => {
        if (board[index] || winner || seriesWinner) return;

        if (gameMode === 'bot' && turn !== 'X') return;

        const newBoard = [...board];
        newBoard[index] = turn; 
        setBoard(newBoard);

        const result = checkWinner(newBoard);
        if (result) {
            handleGameEnd(result);
        } else {
            setTurn(turn === 'X' ? 'O' : 'X');
        }
    };

    // Funciones Online
    const getGameRef = (code) => {
        return doc(db, 'artifacts', appId, 'public', 'data', 'matches', code);
    };

    const generateRoomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

    const subscribeToGame = useCallback((code) => {
        if (unsubscribeRef.current) unsubscribeRef.current();
        const gameRef = getGameRef(code);
        unsubscribeRef.current = onSnapshot(gameRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setBoard(data.board);
                setTurn(data.turn);
                setScores(data.scores);
                setWinner(data.winner);
                setWinningLine(data.winningLine || []);
                setRoundStarter(data.roundStarter);
                
                if (myRole === 'X') {
                    setOpponentName(data.players.O || 'Esperando...');
                } else if (myRole === 'O') {
                    setOpponentName(data.players.X || 'Esperando...');
                }
                
                // MODIFICADO: Iniciar juego solo si gameStarted es true
                if (data.gameStarted && view === 'lobby') {
                    setView('game');
                }
            }
        }, (error) => {
            console.error("Error en snapshot:", error);
            setErrorMsg("Error de conexión");
        });
    }, [view, myRole]);

    const createOnlineGame = useCallback(async () => {
        if (!user) return;
        const code = generateRoomCode();
        const timestamp = Date.now();
        setRoomId(code);
        setMyRole('X');
        setGameMode('online');
        setOpponentName('Esperando...');
        
        const gameRef = getGameRef(code);
        
        // CORRECCIÓN: Date.now() llamada dentro de useCallback
        await setDoc(gameRef, {
            board: Array(9).fill(null),
            turn: 'X',
            roundStarter: 'X',
            players: { X: playerName, O: null },
            scores: { X: 0, O: 0 },
            winner: null,
            winningLine: [],
            gameStarted: false, // NUEVO
            createdAt: timestamp 
        });

        subscribeToGame(code);
        setView('lobby');
    }, [user, playerName, subscribeToGame]);

    const joinOnlineGame = async () => {
        if (!user || !joinCode) return;
        setErrorMsg(''); // Limpiar errores previos
        
        const code = joinCode.toUpperCase().trim();
        const gameRef = getGameRef(code);
        
        try {
            const snap = await getDoc(gameRef);

            if (snap.exists()) {
                const data = snap.data();
                
                // Verificar que el jugador O no esté ocupado
                if (!data.players.O) {
                    await updateDoc(gameRef, {
                        'players.O': playerName
                    });
                    
                    setRoomId(code);
                    setMyRole('O');
                    setGameMode('online');
                    setOpponentName(data.players.X); // Establecer el nombre del oponente
                    subscribeToGame(code);
                    setView('game'); // Ir directo al juego
                } else {
                    setErrorMsg('La partida está llena.');
                }
            } else {
                setErrorMsg('Código inválido.');
            }
        } catch (error) {
            console.error("Error al unirse:", error);
            setErrorMsg('Error al conectar. Verifica tu conexión.');
        }
    };
    const startOnlineGame = async () => {
        const gameRef = getGameRef(roomId);
        await updateDoc(gameRef, {
            gameStarted: true
        });
    };

    const handleOnlineClick = async (index) => {
        if (board[index] || winner || seriesWinner || turn !== myRole) return;

        const newBoard = [...board];
        newBoard[index] = myRole;
        
        const result = checkWinner(newBoard);
        const gameRef = getGameRef(roomId);
        
        let updates = {
            board: newBoard,
            turn: myRole === 'X' ? 'O' : 'X'
        };

        if (result) {
            updates.winner = result.winner;
            updates.winningLine = result.line;
            if (result.winner !== 'Draw') {
                updates[`scores.${result.winner}`] = scores[result.winner] + 1;
            }
        }

        await updateDoc(gameRef, updates);
    };

    const nextRound = async () => {
        const nextStarter = roundStarter === 'X' ? 'O' : 'X';
        
        if (gameMode === 'bot' || gameMode === 'local') {
            setBoard(Array(9).fill(null));
            setWinner(null);
            setWinningLine([]);
            setRoundStarter(nextStarter);
            setTurn(nextStarter);
        } else {
            const gameRef = getGameRef(roomId);
            await updateDoc(gameRef, {
                board: Array(9).fill(null),
                winner: null,
                winningLine: [],
                roundStarter: nextStarter,
                turn: nextStarter
            });
        }
    };

    const resetAll = () => {
        if (unsubscribeRef.current) unsubscribeRef.current();
        setView('menu');
        setGameMode(null);
        setWinner(null);
        setSeriesWinner(null);
        setWinningLine([]);
        setScores({ X: 0, O: 0 });
        setErrorMsg('');
        setRoomId(null);
    };

    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(roomId);
            setCopied(true);
        } catch (error) {
            console.error('Error al copiar:', error);
            const textArea = document.createElement("textarea");
            textArea.value = roomId;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                setCopied(true);
            } catch (innerError) {
                console.error('Error al copiar fallback:', innerError);
            }
            document.body.removeChild(textArea);
        }
        setTimeout(() => setCopied(false), 2000);
    };

    // --- RENDERIZADO ---

    // 1. PANTALLA DE SETUP
    if (view === 'setup') {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
                <div className="max-w-md w-full bg-slate-800 rounded-2xl p-8 shadow-2xl border border-slate-700">
                    <h1 className="text-3xl font-bold text-center mb-2 text-indigo-400">3 en Raya</h1>
                    <p className="text-center text-slate-400 mb-8">Ingresa tu nombre para comenzar</p>
                    <input
                        type="text"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        placeholder="Tu Nombre..."
                        maxLength={12}
                        className="w-full bg-slate-700 text-white px-4 py-3 rounded-xl mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button
                        disabled={!playerName.trim()}
                        onClick={() => setView('menu')}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                    >
                        Continuar <ArrowRight size={20} />
                    </button>
                </div>
            </div>
        );
    }

    // 2. MENÚ PRINCIPAL
    if (view === 'menu') {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
                <h1 className="text-3xl font-bold mb-8 text-indigo-400">Elige un Modo</h1>
                
                <div className="grid gap-4 w-full max-w-md">
                    
                    {/* Botón Vs Bot */}
                    <button onClick={startBotGame} className="bg-slate-800 hover:bg-slate-750 p-6 rounded-2xl border border-slate-700 flex items-center justify-between group transition-all hover:border-indigo-500/50">
                        <div className="flex items-center gap-4">
                            <div className="bg-indigo-500/20 p-3 rounded-xl text-indigo-400">
                                <Cpu size={28} />
                            </div>
                            <div className="text-left">
                                <h3 className="font-bold text-lg">Vs BOT</h3>
                                <p className="text-sm text-slate-400">Práctica en solitario</p>
                            </div>
                        </div>
                        <ArrowRight className="text-slate-600 group-hover:text-indigo-400 transition-colors" />
                    </button>

                    {/* Botón Vs Local */}
                    <button onClick={startLocalGame} className="bg-slate-800 hover:bg-slate-750 p-6 rounded-2xl border border-slate-700 flex items-center justify-between group transition-all hover:border-yellow-500/50">
                        <div className="flex items-center gap-4">
                            <div className="bg-yellow-500/20 p-3 rounded-xl text-yellow-400">
                                <Smartphone size={28} />
                            </div>
                            <div className="text-left">
                                <h3 className="font-bold text-lg">Vs Jugador (Local)</h3>
                                <p className="text-sm text-slate-400">Mismo dispositivo</p>
                            </div>
                        </div>
                        <ArrowRight className="text-slate-600 group-hover:text-yellow-400 transition-colors" />
                    </button>

                    {/* Botón Crear Partida */}
                    <button onClick={createOnlineGame} className="bg-slate-800 hover:bg-slate-750 p-6 rounded-2xl border border-slate-700 flex items-center justify-between group transition-all hover:border-emerald-500/50">
                        <div className="flex items-center gap-4">
                            <div className="bg-emerald-500/20 p-3 rounded-xl text-emerald-400">
                                <User size={28} />
                            </div>
                            <div className="text-left">
                                <h3 className="font-bold text-lg">Vs Jugador (Online)</h3>
                                <p className="text-sm text-slate-400">Genera un código</p>
                            </div>
                        </div>
                        <ArrowRight className="text-slate-600 group-hover:text-emerald-400 transition-colors" />
                    </button>

                    {/* Botón Unirse */}
                    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            <div className="bg-rose-500/20 p-3 rounded-xl text-rose-400">
                                <Users size={28} />
                            </div>
                            <div className="text-left">
                                <h3 className="font-bold text-lg">Unirse a Partida</h3>
                                <p className="text-sm text-slate-400">Ingresa el código de amigo</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <input 
                                value={joinCode}
                                onChange={(e) => setJoinCode(e.target.value)}
                                placeholder="CÓDIGO"
                                className="bg-slate-900 flex-1 px-4 py-2 rounded-lg border border-slate-600 focus:border-rose-500 outline-none uppercase tracking-widest font-mono"
                            />
                            <button 
                                onClick={joinOnlineGame}
                                disabled={joinCode.length < 6}
                                className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-4 rounded-lg font-bold"
                            >
                                Ir
                            </button>
                        </div>
                        {errorMsg && <p className="text-rose-400 text-sm">{errorMsg}</p>}
                    </div>

                </div>
                <button onClick={() => setView('setup')} className="mt-8 text-slate-500 text-sm hover:text-slate-300">Cambiar nombre</button>
            </div>
        );
    }

    // 3. LOBBY
    if (view === 'lobby') {
        const isHost = myRole === 'X';
        const opponentJoined = opponentName !== 'Esperando...';
        
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white text-center">
                <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-md w-full">
                    <div className="animate-pulse bg-emerald-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Users className="text-emerald-400" size={32} />
                    </div>
                    
                    {isHost ? (
                        // Vista del Host (quien creó la partida)
                        <>
                            <h2 className="text-2xl font-bold mb-2">
                                {opponentJoined ? '¡Rival conectado!' : 'Esperando rival...'}
                            </h2>
                            <p className="text-slate-400 mb-6">
                                {opponentJoined 
                                    ? `${opponentName} se ha unido. ¡Inicia cuando estés listo!`
                                    : 'Comparte este código para jugar:'}
                            </p>
                            
                            <div className="bg-slate-900 p-4 rounded-xl flex items-center justify-between mb-6 border border-slate-700">
                                <span className="text-3xl font-mono font-bold tracking-[0.2em] text-emerald-400">{roomId}</span>
                                <button onClick={copyCode} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                                    {copied ? <Check size={24} className="text-emerald-500"/> : <Copy size={24} className="text-slate-400"/>}
                                </button>
                            </div>

                            {opponentJoined && (
                                <button 
                                    onClick={startOnlineGame}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded-xl font-bold flex items-center justify-center gap-2 mb-4 animate-in slide-in-from-bottom-2"
                                >
                                    <Play size={20} /> Iniciar Partida
                                </button>
                            )}
                        </>
                    ) : (
                        // Vista del invitado (quien se unió)
                        <>
                            <h2 className="text-2xl font-bold mb-2">¡Conectado!</h2>
                            <p className="text-slate-400 mb-6">
                                Esperando que <span className="text-emerald-400 font-bold">{opponentName}</span> inicie la partida...
                            </p>
                            <div className="bg-slate-900 p-4 rounded-xl mb-6 border border-slate-700">
                                <p className="text-slate-500 text-sm">Sala: <span className="text-emerald-400 font-mono">{roomId}</span></p>
                            </div>
                        </>
                    )}

                    <button onClick={resetAll} className="text-slate-500 hover:text-white">Cancelar</button>
                </div>
            </div>
        );
    }

    // 4. PANTALLA FINAL
    if (seriesWinner) {
        let didIWin = false;
        // La lógica local es solo para mostrar el mensaje de felicitación, no determina el ganador final.
        if (gameMode !== 'local') didIWin = gameMode === 'bot' ? seriesWinner === 'X' : seriesWinner === myRole;
        
        const winnerName = seriesWinner === 'X' 
            ? playerName 
            : (gameMode === 'bot' ? 'Bot' : opponentName);

        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white text-center animate-in zoom-in duration-300">
                <Trophy className={`w-24 h-24 mb-6 ${didIWin ? 'text-yellow-400' : 'text-slate-600'}`} />
                <h1 className="text-4xl font-bold mb-2">
                    {seriesWinner === 'Draw' ? '¡Empate Final!' : `¡${winnerName} gana la serie!`}
                </h1>
                <p className="text-xl text-slate-300 mb-8">
                    {`Marcador Final: ${scores.X} - ${scores.O}`}
                </p>
                <button onClick={resetAll} className="bg-indigo-600 hover:bg-indigo-500 px-8 py-3 rounded-xl font-bold flex items-center gap-2 mx-auto">
                    <RotateCcw size={20}/> Menú Principal
                </button>
            </div>
        );
    }

    // 5. JUEGO PRINCIPAL
    const mySymbol = gameMode === 'online' ? myRole : 'X';

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
            <div className="w-full max-w-sm mx-auto"> 
                
                {/* Cabecera del Juego: Estable */}
                <div className="grid grid-cols-3 items-center mb-6 bg-slate-800 p-3 rounded-2xl border border-slate-700 shadow-lg">
                    
                    {/* JUGADOR 1 (X) */}
                    <div className={`flex flex-col items-center p-2 rounded-xl transition-all duration-300 border-2 
                        ${turn === 'X' ? 'border-indigo-500 bg-indigo-500/10' : 'border-transparent opacity-60'}`}>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">
                            {gameMode === 'online' && myRole === 'X' ? 'Tú (X)' : 'Jugador X'}
                        </p>
                        <p className="font-bold text-sm truncate w-full text-center">
                            {gameMode === 'online' && myRole === 'X' ? playerName : (gameMode === 'online' && myRole === 'O' ? opponentName : playerName)}
                        </p>
                        <p className="text-xl font-bold text-indigo-400">{scores.X}</p>
                    </div>
                    
                    {/* Centro (VS) */}
                    <div className="text-center">
                        <div className="text-slate-600 font-black text-lg">VS</div>
                        <div className="text-[10px] text-slate-500 mt-1 font-mono">Rnd {scores.X + scores.O + 1}</div>
                    </div>

                    {/* JUGADOR 2 (O) */}
                    <div className={`flex flex-col items-center p-2 rounded-xl transition-all duration-300 border-2
                        ${turn === 'O' ? 'border-rose-500 bg-rose-500/10' : 'border-transparent opacity-60'}`}>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">
                            {gameMode === 'online' && myRole === 'O' ? 'Tú (O)' : 'Jugador O'}
                        </p>
                        <p className="font-bold text-sm truncate w-full text-center">
                            {gameMode === 'online' && myRole === 'O' ? playerName : (gameMode === 'online' ? opponentName : opponentName)}
                        </p>
                        <p className="text-xl font-bold text-rose-400">{scores.O}</p>
                    </div>
                </div>

                {/* Mensaje de Estado (Altura fija) */}
                <div className="flex items-center justify-center mb-6 h-8 min-h-[2rem]">
                    {winner ? (
                        <span className={`px-4 py-1 rounded-full font-bold text-sm sm:text-base ${winner === 'Draw' ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500/20 text-emerald-400'}`}>
                            {winner === 'Draw' ? 'Empate' : `¡${winner === 'X' ? (gameMode === 'online' && mySymbol === 'X' ? 'Tú' : playerName) : (gameMode === 'online' && mySymbol === 'O' ? 'Tú' : opponentName)} gana!`}
                        </span>
                    ) : (
                        <span className="text-slate-400 text-sm animate-pulse">
                            {gameMode === 'online' 
                                ? (turn === myRole ? 'Tu turno' : `Esperando a ${opponentName}...`)
                                : `Turno de ${turn === 'X' ? playerName : opponentName}`}
                        </span>
                    )}
                </div>

                {/* Tablero: Aspect Square con filas forzadas */}
                <div className="grid grid-cols-3 grid-rows-3 gap-2 sm:gap-3 bg-slate-800 p-2 sm:p-3 rounded-2xl shadow-2xl aspect-square mb-6 border border-slate-700 max-h-[60vh] w-full max-w-[60vh] mx-auto">
                    {board.map((cell, i) => {
                        const isWinningCell = winningLine.includes(i);
                        const canClick = !cell && !winner && (gameMode !== 'online' || turn === myRole);
                        
                        return (
                            <button
                                key={i}
                                onClick={() => gameMode === 'online' ? handleOnlineClick(i) : handleOfflineClick(i)}
                                disabled={!canClick}
                                className={`
                                    relative rounded-xl flex items-center justify-center transition-all duration-200 w-full h-full
                                    ${cell === null ? 'bg-slate-900 hover:bg-slate-750' : 'bg-slate-900'}
                                    ${isWinningCell ? 'bg-emerald-900/50 ring-2 ring-emerald-500' : ''}
                                    ${canClick ? 'cursor-pointer active:scale-95' : 'cursor-default'}
                                `}
                            >
                                {/* Iconos responsivos */}
                                {cell === 'X' && <X className={`w-3/4 h-3/4 ${isWinningCell ? 'text-emerald-400' : 'text-indigo-500'} transition-colors`} strokeWidth={3} />}
                                {cell === 'O' && <Circle className={`w-3/4 h-3/4 ${isWinningCell ? 'text-emerald-400' : 'text-rose-500'} transition-colors`} strokeWidth={4} />}
                            </button>
                        );
                    })}
                </div>

                {/* Controles de Pie de página */}
                <div className="h-16"> 
                    {winner ? (
                        <button 
                            onClick={nextRound}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-900/20 transition-all animate-in slide-in-from-bottom-2"
                        >
                            Siguiente Ronda
                        </button>
                    ) : (
                        gameMode === 'online' && (
                            <div className="text-center bg-slate-800/50 py-2 rounded-lg border border-slate-700/50">
                                <p className="text-slate-500 text-[10px] font-mono uppercase">Sala: {roomId}</p>
                            </div>
                        )
                    )}
                </div>

                <button onClick={resetAll} className="w-full mt-2 text-slate-500 hover:text-slate-300 text-xs py-2">
                    Abandonar Partida
                </button>

            </div>
        </div>
    );
};

export default TresEnRaya;
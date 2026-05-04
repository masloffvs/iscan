import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { defineExecutor, defineModule, type InteractiveApplicationProps } from "../module";

type Player = "X" | "O" | null;

type TicTacToeProps = InteractiveApplicationProps & {
	// additional props if needed
};

function TicTacToe({ width, height, onExit }: TicTacToeProps) {
	const [board, setBoard] = useState<Player[]>(Array(9).fill(null));
	const [cursor, setCursor] = useState<number>(0);
	const [winner, setWinner] = useState<Player | "Draw">(null);
	const [isPlayerTurn, setIsPlayerTurn] = useState<boolean>(true);

	const checkWinner = (squares: Player[]) => {
		const lines = [
			[0, 1, 2],
			[3, 4, 5],
			[6, 7, 8],
			[0, 3, 6],
			[1, 4, 7],
			[2, 5, 8],
			[0, 4, 8],
			[2, 4, 6],
		];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line) {
				const [a, b, c] = line;
				if (a !== undefined && b !== undefined && c !== undefined) {
					if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
						return squares[a];
					}
				}
			}
		}
		if (squares.every((square) => square !== null)) {
			return "Draw";
		}
		return null;
	};

	const makeComputerMove = (currentBoard: Player[]) => {
		const available = currentBoard.map((val, idx) => (val === null ? idx : null)).filter((val): val is number => val !== null);
		if (available.length === 0) return;
		const randomMove = available[Math.floor(Math.random() * available.length)];
		if (randomMove === undefined) return;
		const newBoard = [...currentBoard];
		newBoard[randomMove] = "O";
		setBoard(newBoard);
		
		const currentWinner = checkWinner(newBoard);
		if (currentWinner) {
			setWinner(currentWinner);
		} else {
			setIsPlayerTurn(true);
		}
	};

	useEffect(() => {
		if (!isPlayerTurn && !winner) {
			const timer = setTimeout(() => {
				makeComputerMove(board);
			}, 500);
			return () => clearTimeout(timer);
		}
	}, [isPlayerTurn, board, winner]);

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			onExit(0);
			return;
		}

		if (winner) {
			if (key.return) {
				onExit(0);
			}
			return;
		}

		if (!isPlayerTurn) return;

		if (key.upArrow) {
			setCursor((c) => (c >= 3 ? c - 3 : c));
		} else if (key.downArrow) {
			setCursor((c) => (c <= 5 ? c + 3 : c));
		} else if (key.leftArrow) {
			setCursor((c) => (c % 3 !== 0 ? c - 1 : c));
		} else if (key.rightArrow) {
			setCursor((c) => (c % 3 !== 2 ? c + 1 : c));
		} else if (key.return || input === " ") {
			if (board[cursor] === null) {
				const newBoard = [...board];
				newBoard[cursor] = "X";
				setBoard(newBoard);
				
				const currentWinner = checkWinner(newBoard);
				if (currentWinner) {
					setWinner(currentWinner);
				} else {
					setIsPlayerTurn(false);
				}
			}
		}
	});

	const renderCell = (index: number) => {
		const isSelected = index === cursor && !winner;
		const val = board[index] || " ";
		
		let bgColor = isSelected ? "#4b5563" : undefined; // gray-600
		let color = "#e5e7eb"; // gray-200

		if (val === "X") color = "#60a5fa"; // blue-400
		if (val === "O") color = "#f87171"; // red-400

		return (
			<Box 
				key={index}
				width={7} 
				height={3} 
				borderStyle="single" 
				borderColor={isSelected ? "#9ca3af" : "#374151"} 
				justifyContent="center" 
				alignItems="center"
				backgroundColor={bgColor}
			>
				<Text color={color} bold>{val}</Text>
			</Box>
		);
	};

	return (
		<Box 
			flexDirection="column" 
			alignItems="center" 
			justifyContent="center" 
			width={width} 
			height={height}
		>
			<Text color="#60a5fa" bold>Tic-Tac-Toe</Text>
			<Box marginBottom={1}>
				<Text color="#9ca3af">You: <Text color="#60a5fa" bold>X</Text> | Computer: <Text color="#f87171" bold>O</Text></Text>
			</Box>

			<Box flexDirection="column">
				<Box>{[0, 1, 2].map(renderCell)}</Box>
				<Box>{[3, 4, 5].map(renderCell)}</Box>
				<Box>{[6, 7, 8].map(renderCell)}</Box>
			</Box>

			<Box marginTop={1} height={2}>
				{winner ? (
					<Text color={winner === "Draw" ? "#fbbf24" : winner === "X" ? "#34d399" : "#f87171"} bold>
						{winner === "Draw" ? "It's a draw!" : winner === "X" ? "You won!" : "Computer wins!"} 
						<Text color="#9ca3af" dimColor> (Press Enter to exit)</Text>
					</Text>
				) : (
					<Text color="#9ca3af">
						{isPlayerTurn ? "Your turn (Arrows to move, Space/Enter to place)" : "Computer is thinking..."}
					</Text>
				)}
			</Box>
			<Box marginTop={1}>
				<Text dimColor color="#6b7280">Press ESC to exit</Text>
			</Box>
		</Box>
	);
}

export const gamesTicTacToeModule = defineModule({
	id: "games/tictactoe",
	description: "Play a game of Tic-Tac-Toe against the computer.",
	category: "games",
	executor: defineExecutor(async (context) => {
		const exitCode = await context.runInteractiveApplication(TicTacToe);
		return { exitCode };
	}),
});
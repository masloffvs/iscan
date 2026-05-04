import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { defineExecutor, defineModule, type InteractiveApplicationProps } from "../module";

const WORDS = [
	"TYPESCRIPT",
	"TERMINAL",
	"HANGMAN",
	"DEVELOPER",
	"INTERFACE",
	"MODULE",
	"CONSOLE",
	"DEBUG",
	"APPLICATION",
	"COMPONENT"
];

const HANGMAN_PICS = [
	`
  +---+
  |   |
      |
      |
      |
      |
=========`,
	`
  +---+
  |   |
  O   |
      |
      |
      |
=========`,
	`
  +---+
  |   |
  O   |
  |   |
      |
      |
=========`,
	`
  +---+
  |   |
  O   |
 /|   |
      |
      |
=========`,
	`
  +---+
  |   |
  O   |
 /|\\  |
      |
      |
=========`,
	`
  +---+
  |   |
  O   |
 /|\\  |
 /    |
      |
=========`,
	`
  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========`
];

type HangmanProps = InteractiveApplicationProps & {
	// additional props if needed
};

function Hangman({ width, height, onExit }: HangmanProps) {
	const [word, setWord] = useState<string>("");
	const [guessedLetters, setGuessedLetters] = useState<Set<string>>(new Set());
	const [mistakes, setMistakes] = useState<number>(0);
	const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");

	useEffect(() => {
		const randomWord = WORDS[Math.floor(Math.random() * WORDS.length)];
		if (randomWord) {
			setWord(randomWord);
		}
	}, []);

	useEffect(() => {
		if (!word) return;

		let isWon = true;
		for (const letter of word) {
			if (!guessedLetters.has(letter)) {
				isWon = false;
				break;
			}
		}

		if (isWon) {
			setStatus("won");
		} else if (mistakes >= HANGMAN_PICS.length - 1) {
			setStatus("lost");
		}
	}, [guessedLetters, mistakes, word]);

	useInput((input, key) => {
		if (key.escape || (key.ctrl && input === "c")) {
			onExit(0);
			return;
		}

		if (status !== "playing") {
			if (key.return || input === " ") {
				onExit(0);
			}
			return;
		}

		const letter = input.toUpperCase();
		if (letter >= "A" && letter <= "Z" && letter.length === 1) {
			if (!guessedLetters.has(letter)) {
				const newGuessed = new Set(guessedLetters);
				newGuessed.add(letter);
				setGuessedLetters(newGuessed);

				if (!word.includes(letter)) {
					setMistakes((m) => m + 1);
				}
			}
		}
	});

	if (!word) {
		return <Text>Loading...</Text>;
	}

	const displayWord = word
		.split("")
		.map((letter) => (guessedLetters.has(letter) ? letter : "_"))
		.join(" ");

	const pic = HANGMAN_PICS[Math.min(mistakes, HANGMAN_PICS.length - 1)] || "";
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

	return (
		<Box 
			flexDirection="column" 
			alignItems="center" 
			justifyContent="center" 
			width={width} 
			height={height}
		>
			<Text color="#60a5fa" bold>Hangman</Text>
			
			<Box marginY={1}>
				<Text color="#f87171">{pic}</Text>
			</Box>

			<Box marginBottom={1}>
				<Text bold>Word: <Text color="#e5e7eb" bold>{displayWord}</Text></Text>
			</Box>

			<Box width={30} flexWrap="wrap" justifyContent="center" marginBottom={1}>
				{alphabet.map((letter) => {
					const isGuessed = guessedLetters.has(letter);
					const isCorrect = isGuessed && word.includes(letter);
					const isWrong = isGuessed && !word.includes(letter);

					let color = "#6b7280"; // gray-500
					if (isCorrect) color = "#34d399"; // green-400
					if (isWrong) color = "#f87171"; // red-400

					return (
						<Box key={letter} marginRight={1}>
							<Text color={color}>{letter}</Text>
						</Box>
					);
				})}
			</Box>

			<Box height={2} marginTop={1}>
				{status === "won" && (
					<Text color="#34d399" bold>
						You survived! 
						<Text color="#9ca3af" dimColor> (Press Enter to exit)</Text>
					</Text>
				)}
				{status === "lost" && (
					<Text color="#f87171" bold>
						Game Over! The word was {word}.
						<Text color="#9ca3af" dimColor> (Press Enter to exit)</Text>
					</Text>
				)}
				{status === "playing" && (
					<Text color="#9ca3af">
						Type a letter A-Z to guess.
					</Text>
				)}
			</Box>
			
			<Box marginTop={1}>
				<Text dimColor color="#6b7280">Press ESC to exit</Text>
			</Box>
		</Box>
	);
}

export const gamesHangmanModule = defineModule({
	id: "games/hangman",
	description: "Play a classic game of Hangman.",
	category: "games",
	executor: defineExecutor(async (context) => {
		const exitCode = await context.runInteractiveApplication(Hangman);
		return { exitCode };
	}),
});
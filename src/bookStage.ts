import { createContext, useContext } from "react";

/** All page coordinates and font sizes are in this fixed coordinate space. */
export const BOOK_STAGE_WIDTH = 800;
export const BOOK_STAGE_HEIGHT = 600;

export const BookStageScaleContext = createContext<number>(1);

export function useBookStageScale(): number {
  return useContext(BookStageScaleContext);
}

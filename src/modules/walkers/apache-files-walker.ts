import { Walker } from "./walker";
import { Result, adapter, asLinksTraversal, type TraversedFile } from "../adapters";
import { $axios } from "../../axios";
import { logger } from "../../logger";
import { NetAddr } from "../../primitives";

export type ApacheWalkerParams = {
  maxDepth?: number;
};

export type WalkedDirectory = {
  url: string;
  files: TraversedFile[];
  error?: string;
};

export class ApacheFilesWalker extends Walker<NetAddr, ApacheWalkerParams, WalkedDirectory[]> {
  // this.data is the starting server address
  
  async run(params: ApacheWalkerParams = {}): Promise<Result<WalkedDirectory[]>> {
    const maxDepth = params.maxDepth ?? 2; // Default to depth 2 to prevent excessive crawling
    const results: WalkedDirectory[] = [];
    const visited = new Set<string>();
    
    // BFS queue
    const queue: { url: string; depth: number }[] = [{ url: this.data.toUrl(), depth: 0 }];
    
    try {
      while (queue.length > 0) {
        const current = queue.shift()!;
        
        if (visited.has(current.url)) continue;
        visited.add(current.url);
        
        logger.debug({ url: current.url, depth: current.depth }, "walking directory");
        
        try {
          // Fetch the directory listing, forcing response to text to avoid JSON auto-parse issues
          const response = await $axios.get(current.url, { responseType: 'text' });
          const responseData = typeof response.data === 'string' 
            ? response.data 
            : JSON.stringify(response.data);
          
          // Use our adapter system to parse the directory response
          const parseResult = adapter(responseData).as(asLinksTraversal);
          
          if (!parseResult.isSuccess) {
              results.push({ url: current.url, files: [], error: String(parseResult.getError()) });
              continue;
          }
          
          const files = parseResult.unwrap();
          results.push({ url: current.url, files });
          
          // Enqueue nested directories if we haven't reached maxDepth
          if (current.depth < maxDepth) {
            for (const file of files) {
              if (file.isDirectory) {
                try {
                  const nextUrl = new URL(file.path, current.url).toString();
                  if (!visited.has(nextUrl)) {
                     queue.push({ url: nextUrl, depth: current.depth + 1 });
                  }
                } catch {
                  // Ignore malformed URLs
                }
              }
            }
          }
        } catch (error: any) {
           logger.error({ url: current.url, error: error.message }, "walker failed to fetch directory");
           results.push({ url: current.url, files: [], error: error.message });
        }
      }
      
      return Result.ok(results);
    } catch (error: any) {
      return Result.fail(error);
    }
  }
}

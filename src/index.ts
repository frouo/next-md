import { resolve, parse, relative } from 'path';
import { Config, File, NextMarkdownFile, NextMarkdownProps } from './types';
import { pathToContent, flatFiles, generateNextmd, readFileSyncUTF8 } from './utils/fs';
import { treeContentRepo } from './utils/git';
import { consoleLogNextmd } from './utils/logger';
import { extractFrontMatter, readMarkdownFile } from './utils/markdown';

/**
 * @param config The config for the next-markdown module.
 * @returns The next markdown module ready-to-use.
 */
const NextMarkdown = (config: Config) => {
  const isContentFetchedFromRemote = config.contentGitRepo !== undefined;
  const finalPathToContent = pathToContent(config.pathToContent, isContentFetchedFromRemote);
  const relativeToAbsolute = (filePath: string) => resolve(finalPathToContent, filePath);
  const absoluteToRelative = (filePath: string) => relative(finalPathToContent, filePath);

  const includeToApply = async (file: File) =>
    config.include
      ? (async (fn: typeof config.include) => {
          const rawdata = readFileSyncUTF8(relativeToAbsolute(file.path));
          const { frontMatter } = extractFrontMatter(rawdata);
          return fn(file, frontMatter);
        })(config.include)
      : file.name !== 'README.md' && file.name.startsWith('_') === false;

  const getAllFiles = async () => {
    const tree = await treeContentRepo(relativeToAbsolute('.'), config.debug ?? false, config.contentGitRepo);
    return flatFiles(tree);
  };

  const getStaticPropsForNextmd = async (nextmd: string[]): Promise<{ props: NextMarkdownProps }> => {
    const allFiles = await getAllFiles();

    const file = allFiles.find(
      (e) => JSON.stringify(nextmd) === JSON.stringify(generateNextmd(absoluteToRelative(e.path))),
    );

    if (file === undefined) {
      throw Error(`Could not find markdown file at path "${nextmd.join('/')}"`);
    }

    const pageData = await readMarkdownFile(relativeToAbsolute(file.path), config);

    const filesInSameDir = allFiles
      .filter((e) => e !== file) // remove itself
      .filter((e) => JSON.stringify(nextmd) === JSON.stringify(absoluteToRelative(parse(e.path).dir).split('/'))); // get files in the same directory

    const filesData: NextMarkdownFile[] = (
      await Promise.all(filesInSameDir.map(async (e) => ({ ...e, isIncluded: await includeToApply(e) })))
    )
      .filter((e) => e.isIncluded)
      .map((e) => {
        const { frontMatter, content } = extractFrontMatter(readFileSyncUTF8(relativeToAbsolute(e.path)));
        return {
          nextmd: generateNextmd(absoluteToRelative(e.path)),
          frontMatter,
          markdown: content,
        };
      });

    return {
      props: {
        ...pageData,
        nextmd,
        files: filesData,
      },
    };
  };

  return {
    getStaticPaths: async () => {
      const allFiles = await getAllFiles();
      const allFilesWithInclude = await Promise.all(
        allFiles.map(async (e) => ({
          ...e,
          isIncluded: await includeToApply(e),
        })),
      );

      if (config.debug) {
        consoleLogNextmd('getStaticPaths:', JSON.stringify(allFilesWithInclude));
      }

      const files = allFilesWithInclude.filter((e) => e.isIncluded);

      return {
        paths: files.map((e) => ({
          params: {
            nextmd: generateNextmd(absoluteToRelative(e.path)),
          },
        })),
        fallback: false, // See the "fallback" section below
      };
    },

    getStaticProps: async (context: { params?: { nextmd: string[] } }): Promise<{ props: NextMarkdownProps }> => {
      const nextmd = context.params?.nextmd;

      if (nextmd === undefined) {
        throw Error('Could not find params "nextmd". Do you name the file `[...nextmd].tsx` or `[...nextmd].jsx`?');
      }

      return getStaticPropsForNextmd(nextmd);
    },
  };
};

export default NextMarkdown;
export * from './types';

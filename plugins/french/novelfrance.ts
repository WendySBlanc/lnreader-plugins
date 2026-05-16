import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';

type NFNovel = {
  title: string;
  slug: string;
  description: string;
  coverImage: string;
  author: string;
  translatorName: string | null;
  status: 'ONGOING' | 'COMPLETED';
  rating: number;
  genres: { id: string; name: string; slug: string }[];
};

type NFNovelsResponse = {
  novels: NFNovel[];
  total: number;
  totalPages: number;
  page: number;
};

type NFSearchResponse = {
  novels: NFNovel[];
  total: number;
  hasMore: boolean;
};

type NFChapter = {
  id: string;
  chapterNumber: number;
  title: string;
  slug: string;
  createdAt: string;
  wordCount: number;
};

type NFChaptersResponse = {
  chapters: NFChapter[];
  total: number;
  take: number;
  hasMore: boolean;
};

type NFParagraph = {
  id: string;
  index: number;
  content: string;
  wordCount: number;
};

type NFChapterContent = {
  id: string;
  chapterNumber: number;
  title: string;
  slug: string;
  paragraphs: NFParagraph[];
};

class NovelFrancePlugin implements Plugin.PagePlugin {
  id = 'novelfrance';
  name = 'NovelFrance';
  icon = 'src/fr/novelfrance/icon.png';
  site = 'https://novelfrance.fr';
  version = '2.0.0';

  private readonly pageSize = 50;

  private toNovelItem(novel: NFNovel): Plugin.NovelItem {
    return {
      name: novel.title,
      path: '/novel/' + novel.slug,
      cover: novel.coverImage ? this.site + novel.coverImage : defaultCover,
    };
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const sort = showLatestNovels
      ? 'latest'
      : (filters?.sort?.value as string) ?? 'popular';
    const genre = filters?.genre?.value as string | undefined;

    const params = new URLSearchParams({ sort, page: String(pageNo) });
    if (genre && genre !== 'all') params.set('genre', genre);

    const r = await fetchApi(`${this.site}/api/novels?${params}`);
    if (!r.ok) return [];
    const data: NFNovelsResponse = await r.json();
    return data.novels.map(n => this.toNovelItem(n));
  }

  async parseNovel(
    novelPath: string,
  ): Promise<Plugin.SourceNovel & { totalPages: number }> {
    const slug = novelPath.replace('/novel/', '');

    const apiRes = await fetchApi(`${this.site}/api/novels/${slug}`);
    if (!apiRes.ok) throw new Error('Impossible de charger le roman');
    const data: NFNovel = await apiRes.json();

    let author = data.author || '';
    if (data.translatorName) author += ` (Trad. ${data.translatorName})`;

    const firstPage = await this.fetchChapterPage(slug, 0, this.pageSize);
    const total = firstPage?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    const chapters = firstPage
      ? firstPage.chapters.map(ch => this.toChapterItem(slug, ch, '1'))
      : [];

    return {
      path: novelPath,
      name: data.title,
      cover: data.coverImage ? this.site + data.coverImage : defaultCover,
      summary: data.description,
      author,
      status:
        data.status === 'ONGOING'
          ? NovelStatus.Ongoing
          : data.status === 'COMPLETED'
            ? NovelStatus.Completed
            : NovelStatus.Unknown,
      genres: data.genres.map(g => g.name).join(', '),
      rating: data.rating,
      totalPages,
      chapters,
    };
  }

  async parsePage(novelPath: string, page: string): Promise<Plugin.SourcePage> {
    const slug = novelPath.replace('/novel/', '');
    const pageNum = parseInt(page, 10) || 1;
    const skip = (pageNum - 1) * this.pageSize;
    const data = await this.fetchChapterPage(slug, skip, this.pageSize);
    if (!data) return { chapters: [] };
    return {
      chapters: data.chapters.map(ch => this.toChapterItem(slug, ch, page)),
    };
  }

  private async fetchChapterPage(
    slug: string,
    skip: number,
    take: number,
  ): Promise<NFChaptersResponse | null> {
    try {
      const r = await fetchApi(
        `${this.site}/api/chapters/${slug}?skip=${skip}&take=${take}`,
      );
      if (!r.ok) return null;
      return (await r.json()) as NFChaptersResponse;
    } catch {
      return null;
    }
  }

  private toChapterItem(
    slug: string,
    ch: NFChapter,
    page: string,
  ): Plugin.ChapterItem {
    return {
      name: ch.title || `Chapitre ${ch.chapterNumber}`,
      path: `/novel/${slug}/${ch.slug}`,
      chapterNumber: ch.chapterNumber,
      releaseTime: ch.createdAt,
      page,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const parts = chapterPath.split('/');
    const novelSlug = parts[2];
    const chapterSlug = parts[3];

    const r = await fetchApi(
      `${this.site}/api/chapters/${novelSlug}/${chapterSlug}`,
    );
    if (!r.ok) throw new Error('Impossible de charger le chapitre');
    const data: NFChapterContent = await r.json();

    return data.paragraphs
      .sort((a, b) => a.index - b.index)
      .map(p => `<p>${p.content}</p>`)
      .join('\n');
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];
    const r = await fetchApi(
      `${this.site}/api/search?q=${encodeURIComponent(searchTerm)}`,
    );
    if (!r.ok) return [];
    const data: NFSearchResponse = await r.json();
    return data.novels.map(n => this.toNovelItem(n));
  }

  filters = {
    sort: {
      type: FilterTypes.Picker,
      label: 'Trier par',
      value: 'popular',
      options: [
        { label: 'Plus populaires', value: 'popular' },
        { label: 'Mieux notés', value: 'rating' },
        { label: 'Nouveautés', value: 'new' },
      ],
    },
    genre: {
      type: FilterTypes.Picker,
      label: 'Genre',
      value: 'all',
      options: [
        { label: 'Tous', value: 'all' },
        { label: 'Action', value: 'action' },
        { label: 'Adulte', value: 'adulte' },
        { label: 'Anti-Héros', value: 'anti-h-ros' },
        { label: 'Arts Martiaux', value: 'arts-martiaux' },
        { label: 'Aventure', value: 'aventure' },
        { label: 'Comédie', value: 'com-die' },
        { label: 'Drama', value: 'drama' },
        { label: 'Ecchi', value: 'ecchi' },
        { label: 'Fantaisie', value: 'fantaisie' },
        { label: 'Harem', value: 'harem' },
        { label: 'Horreur', value: 'horreur' },
        { label: 'Mature', value: 'mature' },
        { label: 'Mystère', value: 'myst-re' },
        { label: 'Psychologique', value: 'psychologique' },
        { label: 'Réincarnation', value: 'r-incarnation' },
        { label: 'Romance', value: 'romance' },
        { label: 'School Life', value: 'school-life' },
        { label: 'Sci-fi', value: 'sci-fi' },
        { label: 'Seinen', value: 'seinen' },
        { label: 'Slice of Life', value: 'slice-of-life' },
        { label: 'Surnaturel', value: 'surnaturel' },
        { label: 'Tragédie', value: 'trag-die' },
        { label: 'Wuxia', value: 'wuxia' },
        { label: 'Xianxia', value: 'xianxia' },
        { label: 'Xuanhuan', value: 'xuanhuan' },
        { label: 'Yaoi', value: 'yaoi' },
      ],
    },
  } satisfies Filters;
}

export default new NovelFrancePlugin();

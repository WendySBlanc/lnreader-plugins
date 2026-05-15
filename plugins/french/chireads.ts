import { CheerioAPI, load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import dayjs from 'dayjs';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class ChireadsPlugin implements Plugin.PluginBase {
  id = 'chireads';
  name = 'Chireads';
  icon = 'src/fr/chireads/icon.png';
  site = 'https://chireads.com';
  version = '1.0.3';

  async getCheerio(url: string): Promise<CheerioAPI> {
    const r = await fetchApi(url, {
      headers: { 'Accept-Encoding': 'deflate' },
    });
    const body = await r.text();
    const $ = load(body);
    return $;
  }

  async popularNovels(
    pageNo: number,
    { filters, showLatestNovels }: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    let url = this.site;
    let tag = 'all';
    if (showLatestNovels) url += '/category/translatedtales/page/' + pageNo;
    else {
      if (
        filters &&
        typeof filters.tag.value === 'string' &&
        filters.tag.value !== 'all'
      )
        tag = filters.tag.value;
      if (tag !== 'all') url += '/tag/' + tag + '/page/' + pageNo;
      else if (pageNo > 1) return [];
    }
    let $ = await this.getCheerio(url);

    const novels: Plugin.NovelItem[] = [];
    let novel: Plugin.NovelItem;

    if (showLatestNovels || tag !== 'all') {
      let loop = 1;
      if (showLatestNovels) loop = 2;
      for (let i = 0; i < loop; i++) {
        if (i === 1)
          $ = await this.getCheerio(
            this.site + '/category/original/page/' + pageNo,
          );
        $('li:has(img)').each((_, elem) => {
          const novelUrl = $(elem).find('a').first().attr('href');
          const novelCover = $(elem).find('img').attr('src');
          const novelName =
            $(elem).find('h5 a').first().text().trim() ||
            $(elem)
              .find('a')
              .filter((_, a) => !$(a).find('img').length)
              .first()
              .text()
              .trim();

          if (novelUrl && novelName) {
            novel = {
              name: novelName,
              cover: novelCover,
              path: novelUrl.replace(this.site, ''),
            };
            novels.push(novel);
          }
        });
      }
    } else {
      const populaire = $(':contains("Populaire")')
        .last()
        .parent()
        .next()
        .find('li');
      populaire.each((_, elem) => {
        const novelUrl = $(elem).find('a').first().attr('href');
        const novelCover = $(elem).find('img').attr('src');
        const novelName = $(elem)
          .find('a')
          .filter((_, a) => !$(a).find('img').length)
          .first()
          .text()
          .trim();

        if (novelUrl && novelName) {
          novel = {
            name: novelName,
            cover: novelCover || defaultCover,
            path: novelUrl.replace(this.site, ''),
          };
          novels.push(novel);
        }
      });
    }
    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novel: Plugin.SourceNovel = { path: novelPath, name: 'Sans titre' };

    const $ = await this.getCheerio(this.site + novelPath);

    novel.name = $('h3').first().text().trim() || 'Sans titre';
    novel.cover =
      $('img[src*="/uploads/"]').first().attr('src') || defaultCover;

    novel.summary = $('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(t => t.length > 0)
      .join('\n');

    const infos = $('h6').text();
    if (infos.includes('Auteur : ')) {
      const start = infos.indexOf('Auteur : ') + 9;
      const nextKw = infos.indexOf('Traducteur :');
      const endKw = infos.indexOf('Statut de Parution :');
      const end = nextKw > start ? nextKw : endKw > start ? endKw : undefined;
      novel.author = infos.substring(start, end).trim();
    } else if (infos.includes('Fantrad : ')) {
      const start = infos.indexOf('Fantrad : ') + 10;
      const endKw = infos.indexOf('Statut de Parution :');
      novel.author = infos
        .substring(start, endKw > start ? endKw : undefined)
        .trim();
    } else {
      novel.author = 'Inconnu';
    }

    const statusIdx = infos.indexOf('Statut de Parution : ');
    if (statusIdx >= 0) {
      const statusRaw = infos
        .substring(statusIdx + 21)
        .trim()
        .toLowerCase();
      if (statusRaw.includes('terminé') || statusRaw.startsWith('complet')) {
        novel.status = NovelStatus.Completed;
      } else if (statusRaw.includes('pause')) {
        novel.status = NovelStatus.OnHiatus;
      } else {
        novel.status = NovelStatus.Ongoing;
      }
    }

    const chapters: Plugin.ChapterItem[] = [];

    $('a[href*="chapitre-"]').each((i, elem) => {
      const chapterUrl = $(elem).attr('href');
      const chapterName = $(elem).text().trim();
      if (!chapterUrl || !chapterName) return;
      const releaseDate = dayjs(
        chapterUrl.substring(chapterUrl.length - 11, chapterUrl.length - 1),
      ).format('YYYY-MM-DD');
      chapters.push({
        name: chapterName,
        releaseTime: releaseDate,
        path: chapterUrl.replace(this.site, ''),
        chapterNumber: i + 1,
      });
    });

    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterUrl: string): Promise<string> {
    const $ = await this.getCheerio(this.site + chapterUrl);

    return (
      $('.entry-content').html() ||
      $('#content').html() ||
      $('article').html() ||
      ''
    );
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];
    let novels: Plugin.NovelItem[] = [];

    let i = 1;
    let finised = false;
    while (!finised) {
      await this.popularNovels(i, {
        showLatestNovels: true,
        filters: undefined,
      }).then(res => {
        if (res.length === 0) finised = true;
        novels.push(...res);
      });
      i++;
    }

    novels = novels.filter(novel =>
      novel.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .includes(
          searchTerm
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, ''),
        ),
    );

    return novels;
  }

  filters = {
    tag: {
      type: FilterTypes.Picker,
      label: 'Tag',
      value: 'all',
      options: [
        { label: 'Tous', value: 'all' },
        { label: 'Arts martiaux', value: 'arts-martiaux' },
        { label: 'De faible à fort', value: 'de-faible-a-fort' },
        { label: 'Adapté en manhua', value: 'adapte-en-manhua' },
        { label: 'Cultivation', value: 'cultivation' },
        { label: 'Action', value: 'action' },
        { label: 'Aventure', value: 'aventure' },
        { label: 'Monstres', value: 'monstres' },
        { label: 'Xuanhuan', value: 'xuanhuan' },
        { label: 'Fantastique', value: 'fantastique' },
        { label: 'Adapté en Animé', value: 'adapte-en-anime' },
        { label: 'Alchimie', value: 'alchimie' },
        { label: 'Éléments de jeux', value: 'elements-de-jeux' },
        { label: 'Calme Protagoniste', value: 'calme-protagoniste' },
        {
          label: 'Protagoniste intelligent',
          value: 'protagoniste-intelligent',
        },
        { label: 'Polygamie', value: 'polygamie' },
        { label: 'Belle femelle Lea', value: 'belle-femelle-lea' },
        { label: 'Personnages arrogants', value: 'personnages-arrogants' },
        { label: 'Système de niveau', value: 'systeme-de-niveau' },
        { label: 'Cheat', value: 'cheat' },
        { label: 'Protagoniste génie', value: 'protagoniste-genie' },
        { label: 'Comédie', value: 'comedie' },
        { label: 'Gamer', value: 'gamer' },
        { label: 'Mariage', value: 'mariage' },
        { label: 'seeking Protag', value: 'seeking-protag' },
        { label: 'Romance précoce', value: 'romance-precoce' },
        { label: 'Croissance accélérée', value: 'croissance-acceleree' },
        { label: 'Artefacts', value: 'artefacts' },
        {
          label: 'Intelligence artificielle',
          value: 'intelligence-artificielle',
        },
        { label: 'Mariage arrangé', value: 'mariage-arrange' },
        { label: 'Mature', value: 'mature' },
        { label: 'Adulte', value: 'adulte' },
        {
          label: 'Administrateur de système',
          value: 'administrateur-de-systeme',
        },
        { label: 'Beau protagoniste', value: 'beau-protagoniste' },
        {
          label: 'Protagoniste charismatique',
          value: 'protagoniste-charismatique',
        },
        { label: 'Protagoniste masculin', value: 'protagoniste-masculin' },
        { label: 'Démons', value: 'demons' },
        { label: 'Reincarnation', value: 'reincarnation' },
        { label: 'Académie', value: 'academie' },
        {
          label: 'Cacher les vraies capacités',
          value: 'cacher-les-vraies-capacites',
        },
        {
          label: 'Protagoniste surpuissant',
          value: 'protagoniste-surpuissant',
        },
        { label: 'Joueur', value: 'joueur' },
        {
          label: 'Protagoniste fort dès le départ',
          value: 'protagoniste-fort-des-le-depart',
        },
        { label: 'Immortels', value: 'immortels' },
        { label: 'Cultivation rapide', value: 'cultivation-rapide' },
        { label: 'Harem', value: 'harem' },
        { label: 'Assasins', value: 'assasins' },
        { label: 'De pauvre à riche', value: 'de-pauvre-a-riche' },
        {
          label: 'Système de classement de jeux',
          value: 'systeme-de-classement-de-jeux',
        },
        { label: 'Capacités spéciales', value: 'capacites-speciales' },
        { label: 'Vengeance', value: 'vengeance' },
      ],
    },
  } satisfies Filters;
}

export default new ChireadsPlugin();

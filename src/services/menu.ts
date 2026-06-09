import { prisma } from '../db/client.js';
import type { MenuItem } from '@prisma/client';

export type { MenuItem };

export async function getRootMenuItems(): Promise<MenuItem[]> {
  return prisma.menuItem.findMany({
    where: { parentId: null, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function getMenuItemById(id: number): Promise<MenuItem | null> {
  return prisma.menuItem.findUnique({ where: { id } });
}

export async function getChildren(parentId: number): Promise<MenuItem[]> {
  return prisma.menuItem.findMany({
    where: { parentId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function seedDefaultMenus(): Promise<void> {
  const existing = await prisma.menuItem.count();
  if (existing > 0) return;

  const actionSubmenu = await prisma.menuItem.create({
    data: {
      label: '조회 유형 선택',
      actionType: 'submenu',
      actionValue: '',
      sortOrder: 0,
    },
  });

  await prisma.menuItem.createMany({
    data: [
      {
        label: '🌡 기온 조회',
        parentId: actionSubmenu.id,
        actionType: 'action',
        actionValue: '{value}의 현재 기온을 알려줘',
        sortOrder: 0,
      },
      {
        label: '🕐 시간 조회',
        parentId: actionSubmenu.id,
        actionType: 'action',
        actionValue: '{value}의 현재 시간을 알려줘',
        sortOrder: 1,
      },
    ],
  });

  const root = await prisma.menuItem.create({
    data: {
      label: '🌍 지역 날씨/시간 조회',
      actionType: 'submenu',
      actionValue: '',
      sortOrder: 0,
    },
  });

  await prisma.menuItem.createMany({
    data: [
      {
        label: '🇰🇷 한국',
        parentId: root.id,
        actionType: 'tool',
        actionValue: 'cities_by_country:KR',
        resultSubmenuId: actionSubmenu.id,
        sortOrder: 0,
      },
      {
        label: '🇯🇵 일본',
        parentId: root.id,
        actionType: 'tool',
        actionValue: 'cities_by_country:JP',
        resultSubmenuId: actionSubmenu.id,
        sortOrder: 1,
      },
      {
        label: '🇺🇸 미국',
        parentId: root.id,
        actionType: 'tool',
        actionValue: 'cities_by_country:US',
        resultSubmenuId: actionSubmenu.id,
        sortOrder: 2,
      },
    ],
  });

  console.log('✅ Default menus seeded');
}

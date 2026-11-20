export function measure(element) {
    const box = element.getBoundingClientRect();
    const stage = element.querySelector('.arena-pressure__stage');
    const canvas = stage?.querySelector('canvas');
    const canvasBox = canvas?.getBoundingClientRect();
    const data = stage?.dataset ?? {};
    const handY = Number(data.arenaHandY || 0);
    const ropeY = Number(data.arenaRopeY || 0);
    return {
        width: Math.round(box.width), height: Math.round(box.height),
        stageWidth: Math.round(stage?.getBoundingClientRect().width || 0),
        stageHeight: Math.round(stage?.getBoundingClientRect().height || 0),
        canvasWidth: Math.round(canvasBox?.width || 0),
        canvasHeight: Math.round(canvasBox?.height || 0),
        globalScale: canvasBox ? canvasBox.width / 960 : 0,
        characterScale: Number(data.arenaCharacterScale || 0),
        handY, ropeY, handDelta: handY && ropeY ? handY - ropeY : 0,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight
    };
}

use std::cell::RefCell;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use image::RgbaImage;
use servo::{
    Code, DeviceIntRect, DevicePoint, InputEvent, Key, KeyState, KeyboardEvent, LoadStatus,
    Location, Modifiers, MouseButton, MouseButtonAction, MouseButtonEvent, MouseMoveEvent,
    NamedKey, RenderingContext, Servo, ServoBuilder, UserContentManager, UserScript, WebView,
    WebViewBuilder, WheelDelta, WheelEvent, WheelMode,
};
use url::Url;
use winit::dpi::PhysicalSize;

const DEFAULT_SEARCH: &str = "https://etsi.me/search?q=";
const TABS_OPENED: usize = 6;
const ADDRESS_ID: egui::Id = egui::Id::new("prism-address");
const TRUST_MARK: &str = "// Prism: reviewed";

struct RepaintWaker(egui::Context);

impl servo::EventLoopWaker for RepaintWaker {
    fn clone_box(&self) -> Box<dyn servo::EventLoopWaker> {
        Box::new(Self(self.0.clone()))
    }

    fn wake(&self) {
        self.0.request_repaint();
    }
}

struct PageDelegate {
    egui: egui::Context,
    frame_ready: Rc<RefCell<bool>>,
}

impl servo::WebViewDelegate for PageDelegate {
    fn notify_new_frame_ready(&self, _view: WebView) {
        *self.frame_ready.borrow_mut() = true;
        self.egui.request_repaint();
    }
}

struct Tab {
    view: WebView,
    rendering: Rc<servo::SoftwareRenderingContext>,
    texture: Option<egui::TextureHandle>,
    address: String,
    title: String,
    loading: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct BrowserSettings {
    home_url: String,
    search_url: String,
    confirm_extensions: bool,
    ui_scale: f32,
}

impl Default for BrowserSettings {
    fn default() -> Self {
        Self {
            home_url: "https://etsi.me".into(),
            search_url: DEFAULT_SEARCH.into(),
            confirm_extensions: true,
            ui_scale: 1.0,
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct Extension {
    name: String,
    enabled: bool,
    source: String,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
struct BrowserProfile {
    settings: BrowserSettings,
    extensions: Vec<Extension>,
}

struct PrismApp {
    servo: Servo,
    egui: egui::Context,
    user_content: Rc<UserContentManager>,
    user_scripts: Vec<Rc<UserScript>>,
    profile_path: PathBuf,
    settings: BrowserSettings,
    extensions: Vec<Extension>,
    tabs: Vec<Tab>,
    active: usize,
    address_input: String,
    address_focused: bool,
    web_rect: egui::Rect,
    status: String,
    settings_window: bool,
    extensions_window: bool,
    add_extension_window: bool,
    extension_name: String,
    extension_source: String,
    frame_ready: Rc<RefCell<bool>>,
}

impl PrismApp {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let profile_dir = eframe::storage_dir("Prism").unwrap_or_else(|| {
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("Prism")
        });
        let profile_path = profile_dir.join("profile.json");
        let profile: BrowserProfile = fs::read(&profile_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let settings = profile.settings;
        let extensions = profile.extensions;

        let frame_ready = Rc::new(RefCell::new(false));
        cc.egui_ctx.set_pixels_per_point(settings.ui_scale);
        let servo = ServoBuilder::default()
            .event_loop_waker(Box::new(RepaintWaker(cc.egui_ctx.clone())))
            .build();
        servo.setup_logging();
        let user_content = Rc::new(UserContentManager::new(&servo));
        let user_scripts: Vec<_> = extensions
            .iter()
            .filter(|extension| extension.enabled)
            .map(|extension| Rc::new(UserScript::new(extension.source.clone(), None)))
            .collect();
        for script in &user_scripts {
            user_content.add_script(script.clone());
        }

        let mut app = Self {
            servo,
            egui: cc.egui_ctx.clone(),
            user_content,
            user_scripts,
            profile_path,
            settings,
            extensions,
            tabs: Vec::new(),
            active: 0,
            address_input: String::new(),
            address_focused: false,
            web_rect: egui::Rect::NOTHING,
            status: "Prism web engine".into(),
            settings_window: false,
            extensions_window: false,
            add_extension_window: false,
            extension_name: String::new(),
            extension_source: String::new(),
            frame_ready: frame_ready.clone(),
        };
        let home = app.settings.home_url.clone();
        app.open_tab(&home);
        app
    }

    fn save_profile(&self) {
        let profile = BrowserProfile {
            settings: self.settings.clone(),
            extensions: self.extensions.clone(),
        };
        let result = serde_json::to_vec_pretty(&profile)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                let parent = self.profile_path.parent().ok_or_else(|| {
                    "Prism profile has no parent directory".to_string()
                })?;
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                fs::write(&self.profile_path, bytes).map_err(|error| error.to_string())
            });
        if let Err(error) = result {
            log::error!("Unable to save Prism profile: {error}");
        }
    }

    fn open_tab(&mut self, input: &str) {
        if self.tabs.len() >= TABS_OPENED {
            self.status = format!("For stability, Prism limits open tabs to {TABS_OPENED}.");
            return;
        }
        let url = resolve_input(input, &self.settings.search_url);
        let size = PhysicalSize::new(
            (self.web_rect.width().max(1.0) * self.egui.pixels_per_point()).round() as u32,
            (self.web_rect.height().max(1.0) * self.egui.pixels_per_point()).round() as u32,
        );
        let rendering = match servo::SoftwareRenderingContext::new(size) {
            Ok(rendering) => Rc::new(rendering),
            Err(error) => {                    self.status = format!("Could not create Prism's software renderer: {error}");
                return;
            }
        };
        let view = WebViewBuilder::new(&self.servo, rendering.clone())
            .url(url.clone())
            .user_content_manager(self.user_content.clone())
            .hidpi_scale_factor(euclid::Scale::new(self.egui.pixels_per_point()))
            .delegate(Rc::new(PageDelegate {
                egui: self.egui.clone(),
                frame_ready: self.frame_ready.clone(),
            }))
            .build();
        if let Some(previous) = self.active_tab() {
            previous.view.hide();
        }
        view.show();
        *self.frame_ready.borrow_mut() = true;
        self.tabs.push(Tab {
            view,
            rendering,
            texture: None,
            address: url.to_string(),
            title: "Loading…".into(),
            loading: true,
        });
        self.active = self.tabs.len() - 1;
        self.address_input = url.to_string();
    }

    fn active_tab(&self) -> Option<&Tab> {
        self.tabs.get(self.active)
    }

    fn active_tab_mut(&mut self) -> Option<&mut Tab> {
        self.tabs.get_mut(self.active)
    }

    fn navigate(&mut self) {
        let input = self.address_input.trim().to_string();
        if input.is_empty() {
            return;
        }
        let url = resolve_input(&input, &self.settings.search_url);
        if let Some(tab) = self.active_tab_mut() {
            tab.address = url.to_string();
            tab.title = "Loading…".into();
            tab.loading = true;
            tab.view.load(url.clone());
        }
        self.address_input = url.to_string();
        self.egui
            .memory_mut(|memory| memory.request_focus(ADDRESS_ID));
    }

    fn sync_tab_state(&mut self) {
        for tab in &mut self.tabs {
            if let Some(url) = tab.view.url() {
                tab.address = url.to_string();
            }
            if let Some(title) = tab.view.page_title() {
                tab.title = title;
            }
            tab.loading = tab.view.load_status() != LoadStatus::Complete;
        }
        if self.frame_ready.replace(false) {
            if let Some(tab) = self.tabs.get_mut(self.active) {
                let size = tab.rendering.size();
                let rect = DeviceIntRect::from_origin_and_size(
                    servo::DeviceIntPoint::zero(),
                    servo::DeviceIntSize::new(size.width as i32, size.height as i32),
                );
                if let Err(error) = tab.rendering.make_current() {
                    self.status = format!("Could not activate Prism renderer: {error}");
                } else {
                    tab.rendering.prepare_for_rendering();
                    tab.view.paint();
                    if let Some(frame) = tab.rendering.read_to_image(rect) {
                        set_tab_texture(&self.egui, tab, frame);
                    }
                    tab.rendering.present();
                }
            }
        }
        if let Some(tab) = self.active_tab() {
            if !self.address_focused {
                self.address_input = tab.address.clone();
            }
            self.status = if tab.loading {
                "Loading page…".into()
            } else {
                tab.title.clone()
            };
        }
    }

    fn resize_active_view(&mut self, logical_size: egui::Vec2, scale: f32) {
        let width = (logical_size.x.max(1.0) * scale).round().max(1.0) as u32;
        let height = (logical_size.y.max(1.0) * scale).round().max(1.0) as u32;
        if let Some(tab) = self.active_tab_mut() {
            if tab.rendering.size().width != width || tab.rendering.size().height != height {
                let size = PhysicalSize::new(width, height);
                tab.rendering.resize(size);
                tab.view.resize(size);
                tab.view.set_hidpi_scale_factor(euclid::Scale::new(scale));
                *self.frame_ready.borrow_mut() = true;
            }
        }
    }

    fn remove_tab(&mut self, index: usize) {
        if index >= self.tabs.len() {
            return;
        }
        if self.tabs.len() == 1 {
            self.tabs.clear();
            self.active = 0;
            let home = self.settings.home_url.clone();
            self.open_tab(&home);
            return;
        }
        self.tabs.remove(index);
        self.active = if index < self.active {
            self.active - 1
        } else {
            self.active.min(self.tabs.len() - 1)
        };
        if let Some(tab) = self.active_tab() {
            tab.view.show();
            self.address_input = tab.address.clone();
            *self.frame_ready.borrow_mut() = true;
        }
    }

    fn send_pointer_events(&mut self, events: &[egui::Event], scale: f32) {
        let Some(tab) = self.active_tab() else {
            return;
        };
        let view = tab.view.clone();
        for event in events {
            match event {
                egui::Event::PointerMoved(pos) if self.web_rect.contains(*pos) => {
                    let point = DevicePoint::new(
                        (pos.x - self.web_rect.left()) * scale,
                        (pos.y - self.web_rect.top()) * scale,
                    )
                    .into();
                    view.notify_input_event(InputEvent::MouseMove(MouseMoveEvent::new(point)));
                }
                egui::Event::PointerGone => {
                    view.notify_input_event(InputEvent::MouseLeftViewport(
                        servo::MouseLeftViewportEvent {
                            focus_moving_to_another_iframe: false,
                        },
                    ));
                }
                egui::Event::PointerButton {
                    pos,
                    button,
                    pressed,
                    ..
                } if self.web_rect.contains(*pos) => {
                    let point = DevicePoint::new(
                        (pos.x - self.web_rect.left()) * scale,
                        (pos.y - self.web_rect.top()) * scale,
                    )
                    .into();
                    let button = match button {
                        egui::PointerButton::Primary => MouseButton::Primary,
                        egui::PointerButton::Secondary => MouseButton::Secondary,
                        egui::PointerButton::Middle => MouseButton::Auxiliary,
                        egui::PointerButton::Extra1 => MouseButton::Back,
                        egui::PointerButton::Extra2 => MouseButton::Forward,
                    };
                    let action = if *pressed {
                        MouseButtonAction::Down
                    } else {
                        MouseButtonAction::Up
                    };
                    view.notify_input_event(InputEvent::MouseButton(MouseButtonEvent::new(
                        action, button, point,
                    )));
                    if *pressed {
                        view.focus();
                    }
                }
                egui::Event::MouseWheel { unit, delta, .. }
                    if self
                        .web_rect
                        .contains(self.egui.pointer_interact_pos().unwrap_or_default()) =>
                {
                    let (factor, mode) = match unit {
                        egui::MouseWheelUnit::Point => (f64::from(scale), WheelMode::DeltaPixel),
                        egui::MouseWheelUnit::Line => (76.0, WheelMode::DeltaLine),
                        egui::MouseWheelUnit::Page => (1.0, WheelMode::DeltaPage),
                    };
                    let point = self
                        .egui
                        .pointer_interact_pos()
                        .map(|p| {
                            DevicePoint::new(
                                (p.x - self.web_rect.left()) * scale,
                                (p.y - self.web_rect.top()) * scale,
                            )
                            .into()
                        })
                        .unwrap_or_else(|| DevicePoint::new(0.0, 0.0).into());
                    view.notify_input_event(InputEvent::Wheel(WheelEvent::new(
                        WheelDelta {
                            x: f64::from(delta.x) * factor,
                            y: f64::from(delta.y) * factor,
                            z: 0.0,
                            mode,
                        },
                        point,
                    )));
                }
                egui::Event::WindowFocused(focused) => {
                    if *focused {
                        view.focus();
                    } else {
                        view.blur();
                    }
                }
                egui::Event::Copy => view
                    .notify_input_event(InputEvent::EditingAction(servo::EditingActionEvent::Copy)),
                egui::Event::Cut => view
                    .notify_input_event(InputEvent::EditingAction(servo::EditingActionEvent::Cut)),
                egui::Event::Paste(_) => view.notify_input_event(InputEvent::EditingAction(
                    servo::EditingActionEvent::Paste,
                )),
                egui::Event::Text(text) if !self.address_focused && view.focused() => {
                    for character in text.chars() {
                        let key = Key::Character(character.to_string());
                        view.notify_input_event(InputEvent::Keyboard(
                            KeyboardEvent::from_state_and_key(KeyState::Down, key.clone()),
                        ));
                        view.notify_input_event(InputEvent::Keyboard(
                            KeyboardEvent::from_state_and_key(KeyState::Up, key),
                        ));
                    }
                }
                egui::Event::Key {
                    key,
                    pressed,
                    repeat,
                    modifiers,
                    ..
                } if !self.address_focused && view.focused() => {
                    if matches!(key, egui::Key::A..=egui::Key::Z | egui::Key::Num0..=egui::Key::Num9)
                        || matches!(key, egui::Key::Space | egui::Key::Colon | egui::Key::Comma | egui::Key::Backslash | egui::Key::Slash | egui::Key::Pipe | egui::Key::Questionmark | egui::Key::Exclamationmark | egui::Key::OpenBracket | egui::Key::CloseBracket | egui::Key::OpenCurlyBracket | egui::Key::CloseCurlyBracket | egui::Key::Backtick | egui::Key::Minus | egui::Key::Period | egui::Key::Plus | egui::Key::Equals | egui::Key::Semicolon | egui::Key::Quote)
                    {
                        continue;
                    }
                    let state = if *pressed {
                        KeyState::Down
                    } else {
                        KeyState::Up
                    };
                    let code = egui_code(*key);
                    let event = KeyboardEvent::new_without_event(
                        state,
                        egui_key(*key),
                        code,
                        Location::Standard,
                        servo_modifiers(*modifiers),
                        *repeat,
                        false,
                    );
                    view.notify_input_event(InputEvent::Keyboard(event));
                }
                _ => {}
            }
        }
    }

    fn sync_user_scripts(&mut self) {
        for script in self.user_scripts.drain(..) {
            self.user_content.remove_script(script);
        }
        self.user_scripts = self
            .extensions
            .iter()
            .filter(|extension| extension.enabled)
            .map(|extension| Rc::new(UserScript::new(extension.source.clone(), None)))
            .collect();
        for script in &self.user_scripts {
            self.user_content.add_script(script.clone());
        }
    }

    fn add_extension(&mut self) {
        let name = self.extension_name.trim();
        let source = self.extension_source.trim();
        if name.is_empty() || source.is_empty() {
            self.status = "Enter a name and JavaScript user script.".into();
            return;
        }
        if self.settings.confirm_extensions
            && !source.to_ascii_lowercase().contains(TRUST_MARK)
        {
            self.status =
                format!("Review the script, then add \"{TRUST_MARK}\" on its first line to enable it.");
            return;
        }
        let script = Rc::new(UserScript::new(source.to_string(), None));
        self.user_content.add_script(script.clone());
        self.user_scripts.push(script);
        self.extensions.push(Extension {
            name: name.to_string(),
            enabled: true,
            source: source.to_string(),
        });
        self.save_profile();
        self.status = "Prism script added; reload current pages for it to take effect.".into();
        self.add_extension_window = false;
        self.extension_name.clear();
        self.extension_source.clear();
    }
}

fn servo_modifiers(modifiers: egui::Modifiers) -> Modifiers {
    let mut out = Modifiers::empty();
    if modifiers.ctrl {
        out.insert(Modifiers::CONTROL);
    }
    if modifiers.shift {
        out.insert(Modifiers::SHIFT);
    }
    if modifiers.alt {
        out.insert(Modifiers::ALT);
    }
    if modifiers.mac_cmd {
        out.insert(Modifiers::META);
    }
    out
}

fn set_tab_texture(ctx: &egui::Context, tab: &mut Tab, frame: RgbaImage) {
    let image = egui::ColorImage::from_rgba_unmultiplied(
        [frame.width() as usize, frame.height() as usize],
        frame.as_raw(),
    );
    if let Some(texture) = &mut tab.texture {
        texture.set(image, egui::TextureOptions::LINEAR);
    } else {
        tab.texture = Some(ctx.load_texture("prism-page", image, egui::TextureOptions::LINEAR));
    }
}

impl eframe::App for PrismApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.egui = ui.ctx().clone();
        self.servo.spin_event_loop();
        self.sync_tab_state();
        let scale = ui.ctx().pixels_per_point();
        let events = ui.input(|input| input.events.clone());
        let mut requested_tab = None;
        let mut close_tab = None;
        egui::TopBottomPanel::top("prism-tabs").show_inside(ui, |ui| {
            ui.horizontal(|ui| {
                ui.add_space(4.0);
                ui.image(egui::include_image!("../../assets/icon-32.png"));
                for index in 0..self.tabs.len() {
                    let title = self.tabs[index].title.chars().take(22).collect::<String>();
                    let tab = egui::Frame::new()
                        .fill(if self.active == index {
                            egui::Color32::from_rgb(41, 36, 62)
                        } else {
                            egui::Color32::from_rgb(31, 30, 41)
                        })
                        .inner_margin(egui::Margin::symmetric(6, 3))
                        .corner_radius(7)
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                if ui.selectable_label(self.active == index, title).clicked() {
                                    requested_tab = Some(index);
                                }
                                if ui.small_button("×").clicked() {
                                    close_tab = Some(index);
                                }
                            });
                        });
                    let _ = tab;
                }
                if ui
                    .add_enabled(self.tabs.len() < TABS_OPENED, egui::Button::new("+"))
                    .clicked()
                {
                    let home = self.settings.home_url.clone();
                    self.open_tab(&home);
                }
                if ui.button("⚙").on_hover_text("Settings").clicked() {
                    self.settings_window = true;
                }
                if ui.button("◇").on_hover_text("User scripts").clicked() {
                    self.extensions_window = true;
                }
            });
        });
        if let Some(index) = requested_tab {
            if let Some(tab) = self.active_tab() {
                tab.view.hide();
            }
            self.active = index;
            if let Some(tab) = self.active_tab() {
                tab.view.show();
                self.address_input = tab.address.clone();
            }
            *self.frame_ready.borrow_mut() = true;
        }
        if let Some(index) = close_tab {
            self.remove_tab(index);
        }

        let mut should_navigate = false;
        egui::TopBottomPanel::top("prism-toolbar").show_inside(ui, |ui| {
            ui.horizontal(|ui| {
                if ui
                    .add_enabled(
                        self.active_tab().is_some_and(|tab| tab.view.can_go_back()),
                        egui::Button::new("‹"),
                    )
                    .clicked()
                {
                    if let Some(tab) = self.active_tab() {
                        tab.view.go_back(1);
                    }
                }
                if ui
                    .add_enabled(
                        self.active_tab()
                            .is_some_and(|tab| tab.view.can_go_forward()),
                        egui::Button::new("›"),
                    )
                    .clicked()
                {
                    if let Some(tab) = self.active_tab() {
                        tab.view.go_forward(1);
                    }
                }
                if ui.button("↻").on_hover_text("Reload").clicked() {
                    if let Some(tab) = self.active_tab() {
                        tab.view.reload();
                    }
                }
                let address_width = (ui.available_width() - 52.0).max(100.0);
                let response = ui.add_sized(
                    [address_width, 30.0],
                    egui::TextEdit::singleline(&mut self.address_input)
                        .id(ADDRESS_ID)
                        .hint_text("Search Prism or enter an address")
                        .desired_width(f32::INFINITY),
                );
                self.address_focused = response.has_focus();
                if response.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter)) {
                    should_navigate = true;
                }
                if ui.button("Go").clicked() {
                    should_navigate = true;
                }
            });
        });
        if should_navigate {
            self.navigate();
        }
        self.send_pointer_events(&events, scale);

        if self.settings_window {
            let mut open = true;
            egui::Window::new("Prism Browser Settings").open(&mut open).default_width(430.0).show(ui.ctx(), |ui| {
                ui.heading("Browser");
                ui.label("Native Rust desktop app · independent web engine");
                ui.horizontal(|ui| {
                    ui.label("Home page");
                    if ui.text_edit_singleline(&mut self.settings.home_url).changed() {
                        self.save_profile();
                    }
                });
                ui.horizontal(|ui| {
                    ui.label("Search URL");
                    if ui.text_edit_singleline(&mut self.settings.search_url).changed() {
                        self.save_profile();
                    }
                });
                ui.label("Search URL must contain a `%s` query slot; `https://etsi.me/search?q=%s` is the default.");
                ui.horizontal(|ui| {
                    ui.label("UI scale");
                    if ui.add(egui::Slider::new(&mut self.settings.ui_scale, 0.8..=1.5)).changed() {
                        self.egui.set_pixels_per_point(self.settings.ui_scale);
                        self.save_profile();
                    }
                });
                if ui
                    .checkbox(&mut self.settings.confirm_extensions, "Require a reviewed marker on scripts")
                    .changed()
                {
                    self.save_profile();
                }
                ui.label("The browser profile is stored locally as plain JSON. Use this on a trusted device only. This app does not import the legacy encrypted profile vault.");
                ui.separator();
                ui.heading("Engine limitations");
                ui.label("The current web engine is experimental. Chromium Web Store extensions, DRM, some web platform APIs, and high-performance GPU compositing are not available in this build.");
            });
            self.settings_window = open;
        }

        if self.extensions_window {
            let mut open = true;
            egui::Window::new("Prism User Scripts").open(&mut open).default_width(540.0).show(ui.ctx(), |ui| {
                ui.label("Prism user scripts run in every page and have full same-origin page privileges. These are not Chrome or Edge extensions.");
                ui.label("Changes to enable or disable a saved script apply when pages reload.");
                ui.separator();
                let mut remove = None;
                let mut changed = false;
                let mut reload_enabled_scripts = false;
                for (index, extension) in self.extensions.iter_mut().enumerate() {
                    ui.horizontal(|ui| {
                        if ui.checkbox(&mut extension.enabled, &extension.name).changed() {
                            changed = true;
                            reload_enabled_scripts = true;
                        }
                        if ui.button("Remove").clicked() { remove = Some(index); }
                    });
                }
                if changed {
                    self.save_profile();
                    if reload_enabled_scripts {
                        self.sync_user_scripts();
                    }
                }
                if let Some(index) = remove {
                    self.extensions.remove(index);
                    self.save_profile();
                    self.sync_user_scripts();
                    self.status = "Removed from the profile; reload pages to apply.".into();
                }
                ui.separator();
                if ui.button("Add user script…").clicked() { self.add_extension_window = true; }
                ui.label("To reinstall a saved script, remove it and add it again, or restart Prism. Enabling a script injects code at the next document start after reload.");
            });
            self.extensions_window = open;
        }

        if self.add_extension_window {
            let mut open = true;
            egui::Window::new("Add Prism User Script").open(&mut open).default_width(570.0).show(ui.ctx(), |ui| {
                ui.label("Only add code you wrote or fully trust. A user script can read or change the website data available to page JavaScript.");
                ui.horizontal(|ui| { ui.label("Name"); ui.text_edit_singleline(&mut self.extension_name); });
                ui.add(egui::TextEdit::multiline(&mut self.extension_source).hint_text("// Prism: reviewed\n// JavaScript to run on every page").desired_rows(10).desired_width(f32::INFINITY));
                ui.horizontal(|ui| {
                    if ui.button("Add script").clicked() { self.add_extension(); }
                    if ui.button("Cancel").clicked() { self.add_extension_window = false; }
                });
            });
            self.add_extension_window = open && self.add_extension_window;
        }

        egui::CentralPanel::default().show_inside(ui, |ui| {
            let available = ui.available_size_before_wrap();
            let (response, painter) = ui.allocate_painter(available, egui::Sense::click_and_drag());
            self.web_rect = response.rect;
            self.resize_active_view(self.web_rect.size(), scale);
            if let Some(tab) = self.active_tab() {
                if let Some(texture) = &tab.texture {
                    painter.image(
                        texture.id(),
                        self.web_rect,
                        egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1.0, 1.0)),
                        egui::Color32::WHITE,
                    );
                } else {
                    painter.text(
                        self.web_rect.center(),
                        egui::Align2::CENTER_CENTER,
                        "Starting Servo…",
                        egui::FontId::proportional(16.0),
                        egui::Color32::LIGHT_GRAY,
                    );
                }
            } else {
                painter.text(
                    self.web_rect.center(),
                    egui::Align2::CENTER_CENTER,
                    "Open a Prism tab to start browsing.",
                    egui::FontId::proportional(16.0),
                    egui::Color32::LIGHT_GRAY,
                );
            }
        });            egui::TopBottomPanel::bottom("prism-status").show_inside(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label("Prism · independent web engine");
                ui.separator();
                ui.label(&self.status);
                if let Some(tab) = self.active_tab() {
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(tab.address.clone());
                    });
                }
            });
        });
        ui.ctx().request_repaint_after(Duration::from_millis(24));
    }
}

fn egui_key(key: egui::Key) -> Key {
    use egui::Key as E;
    let named = match key {
        E::ArrowDown => NamedKey::ArrowDown,
        E::ArrowLeft => NamedKey::ArrowLeft,
        E::ArrowRight => NamedKey::ArrowRight,
        E::ArrowUp => NamedKey::ArrowUp,
        E::Escape => NamedKey::Escape,
        E::Tab => NamedKey::Tab,
        E::Backspace => NamedKey::Backspace,
        E::Enter => NamedKey::Enter,
        E::Space => return Key::Character(" ".into()),
        E::Delete => NamedKey::Delete,
        E::Home => NamedKey::Home,
        E::End => NamedKey::End,
        E::PageUp => NamedKey::PageUp,
        E::PageDown => NamedKey::PageDown,
        E::Insert => NamedKey::Insert,
        E::F1 => NamedKey::F1,
        E::F2 => NamedKey::F2,
        E::F3 => NamedKey::F3,
        E::F4 => NamedKey::F4,
        E::F5 => NamedKey::F5,
        E::F6 => NamedKey::F6,
        E::F7 => NamedKey::F7,
        E::F8 => NamedKey::F8,
        E::F9 => NamedKey::F9,
        E::F10 => NamedKey::F10,
        E::F11 => NamedKey::F11,
        E::F12 => NamedKey::F12,
        E::A => return Key::Character("a".into()),
        E::B => return Key::Character("b".into()),
        E::C => return Key::Character("c".into()),
        E::D => return Key::Character("d".into()),
        E::E => return Key::Character("e".into()),
        E::F => return Key::Character("f".into()),
        E::G => return Key::Character("g".into()),
        E::H => return Key::Character("h".into()),
        E::I => return Key::Character("i".into()),
        E::J => return Key::Character("j".into()),
        E::K => return Key::Character("k".into()),
        E::L => return Key::Character("l".into()),
        E::M => return Key::Character("m".into()),
        E::N => return Key::Character("n".into()),
        E::O => return Key::Character("o".into()),
        E::P => return Key::Character("p".into()),
        E::Q => return Key::Character("q".into()),
        E::R => return Key::Character("r".into()),
        E::S => return Key::Character("s".into()),
        E::T => return Key::Character("t".into()),
        E::U => return Key::Character("u".into()),
        E::V => return Key::Character("v".into()),
        E::W => return Key::Character("w".into()),
        E::X => return Key::Character("x".into()),
        E::Y => return Key::Character("y".into()),
        E::Z => return Key::Character("z".into()),
        E::Num0 => return Key::Character("0".into()),
        E::Num1 => return Key::Character("1".into()),
        E::Num2 => return Key::Character("2".into()),
        E::Num3 => return Key::Character("3".into()),
        E::Num4 => return Key::Character("4".into()),
        E::Num5 => return Key::Character("5".into()),
        E::Num6 => return Key::Character("6".into()),
        E::Num7 => return Key::Character("7".into()),
        E::Num8 => return Key::Character("8".into()),
        E::Num9 => return Key::Character("9".into()),
        E::Colon => return Key::Character(":".into()),
        E::Comma => return Key::Character(",".into()),
        E::Backslash => return Key::Character("\\".into()),
        E::Slash => return Key::Character("/".into()),
        E::Pipe => return Key::Character("|".into()),
        E::Questionmark => return Key::Character("?".into()),
        E::Exclamationmark => return Key::Character("!".into()),
        E::OpenBracket => return Key::Character("[".into()),
        E::CloseBracket => return Key::Character("]".into()),
        E::OpenCurlyBracket => return Key::Character("{".into()),
        E::CloseCurlyBracket => return Key::Character("}".into()),
        E::Backtick => return Key::Character("`".into()),
        E::Minus => return Key::Character("-".into()),
        E::Period => return Key::Character(".".into()),
        E::Plus => return Key::Character("+".into()),
        E::Equals => return Key::Character("=".into()),
        E::Semicolon => return Key::Character(";".into()),
        E::Quote => return Key::Character("'".into()),
        E::Copy => NamedKey::Copy,
        E::Cut => NamedKey::Cut,
        E::Paste => NamedKey::Paste,
    };
    Key::Named(named)
}

fn egui_code(key: egui::Key) -> Code {
    match key {
        egui::Key::Enter => Code::Enter,
        egui::Key::Space => Code::Space,
        egui::Key::Backspace => Code::Backspace,
        egui::Key::Tab => Code::Tab,
        egui::Key::Escape => Code::Escape,
        egui::Key::Delete => Code::Delete,
        egui::Key::Insert => Code::Insert,
        egui::Key::Home => Code::Home,
        egui::Key::End => Code::End,
        egui::Key::PageUp => Code::PageUp,
        egui::Key::PageDown => Code::PageDown,
        egui::Key::ArrowLeft => Code::ArrowLeft,
        egui::Key::ArrowRight => Code::ArrowRight,
        egui::Key::ArrowUp => Code::ArrowUp,
        egui::Key::ArrowDown => Code::ArrowDown,
        _ => Code::Unidentified,
    }
}

fn resolve_input(input: &str, search_url: &str) -> Url {
    let input = input.trim();
    if input.is_empty() {
        return Url::parse("about:blank").expect("about:blank is valid");
    }
    if let Ok(url) = Url::parse(input) {
        if matches!(url.scheme(), "http" | "https" | "about") {
            return url;
        }
    }
    if input.contains('.') && !input.chars().any(char::is_whitespace) {
        if let Ok(url) = Url::parse(&format!("https://{input}")) {
            return url;
        }
    }
    let encoded = url::form_urlencoded::byte_serialize(input.as_bytes()).collect::<String>();
    let template = if search_url.contains("%s") {
        search_url
    } else {
        DEFAULT_SEARCH
    };
    let base = template.replace("%s", &encoded);
    Url::parse(&base)
        .or_else(|_| Url::parse(&format!("{DEFAULT_SEARCH}{encoded}")))
        .expect("default search URL is valid")
}

fn prism_icon() -> Option<egui::IconData> {
    let image = image::load_from_memory(include_bytes!("../../assets/icon-64.png"))
        .ok()?
        .into_rgba8();
    let (width, height) = image.dimensions();
    Some(egui::IconData {
        rgba: image.into_raw(),
        width,
        height,
    })
}

fn main() -> eframe::Result {
    env_logger::init();
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("Rustls crypto provider");
    let viewport = egui::ViewportBuilder::default()
        .with_title("Prism Browser")
        .with_inner_size([1200.0, 820.0])
        .with_min_inner_size([760.0, 520.0])
        .with_icon(Arc::new(
            prism_icon().expect("the checked-in Prism app icon must decode"),
        ));
    let options = eframe::NativeOptions {
        viewport,
        vsync: true,
        ..Default::default()
    };
    eframe::run_native(
        "Prism Browser",
        options,
        Box::new(|cc| Ok(Box::new(PrismApp::new(cc)))),
    )
}
